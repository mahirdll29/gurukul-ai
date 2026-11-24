import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

export const s3 = new S3Client({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
});

const requiredStorageVariables=['AWS_ENDPOINT_URL_S3','AWS_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','S3_BUCKET'] as const;
export function missingStorageVariables(){return requiredStorageVariables.filter(name=>!process.env[name]);}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Neon Object Storage can return SlowDown (503); retry with bounded exponential backoff. */
export async function sendStorageCommand<T>(command:any):Promise<T>{
  for(let attempt=0;attempt<5;attempt++){
    try{return await s3.send(command) as T;}
    catch(error:any){
      const slowdown=error?.name==='SlowDown'||error?.$metadata?.httpStatusCode===503;
      if(!slowdown||attempt===4)throw error;
      await delay(250*2**attempt);
    }
  }
  throw new Error('Storage request failed after retry.');
}

export async function putObject(key:string,body:Buffer,contentType:string){
  const missing=missingStorageVariables();if(missing.length)throw new Error(`Missing required environment variable: ${missing[0]}`);
  await sendStorageCommand(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:body,ContentType:contentType}));
}

export async function signedDownload(key:string,filename:string){
  const missing=missingStorageVariables();if(missing.length)throw new Error(`Missing required environment variable: ${missing[0]}`);
  return getSignedUrl(s3,new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,ResponseContentDisposition:`attachment; filename="${filename.replace(/["\r\n]/g,'_')}"`}),{expiresIn:60});
}

export async function signedPreview(key:string,filename:string,contentType:string){
  const missing=missingStorageVariables();if(missing.length)throw new Error(`Missing required environment variable: ${missing[0]}`);
  const safeName=filename.replace(/["\r\n]/g,'_');
  return getSignedUrl(s3,new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,ResponseContentDisposition:`inline; filename="${safeName}"`,ResponseContentType:contentType}),{expiresIn:300});
}

export async function removeObject(key:string){
  const missing=missingStorageVariables();if(missing.length)throw new Error(`Missing required environment variable: ${missing[0]}`);
  await sendStorageCommand(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));
}

export async function configureBucketCors(){
  const origins=[...(process.env.CLIENT_ORIGIN||'').split(',').map(x=>x.trim()).filter(Boolean)];
  if(process.env.NODE_ENV!=='production')origins.push('http://localhost:5173');
  const unique=[...new Set(origins)];
  await sendStorageCommand(new PutBucketCorsCommand({Bucket:process.env.S3_BUCKET,CORSConfiguration:{CORSRules:[{AllowedOrigins:unique,AllowedMethods:['PUT','GET','HEAD'],AllowedHeaders:['*'],ExposeHeaders:['ETag'],MaxAgeSeconds:3600}]}}));
}

export async function checkStorageRoundTrip(){
  const missing=missingStorageVariables();if(missing.length)throw new Error(`Missing required environment variable: ${missing.join(', ')}`);
  const key=`gurukul-ai-check/${randomUUID()}`,contents=Buffer.from('gurukul-ai-storage-check');let put=false;
  try{
    await sendStorageCommand(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:contents,ContentType:'text/plain'}));put=true;
    const result=await sendStorageCommand<any>(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));
    const received=Buffer.from(await result.Body.transformToByteArray());
    if(!received.equals(contents))throw new Error('Storage read-back did not match.');
  }finally{
    if(put)await sendStorageCommand(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));
  }
}
