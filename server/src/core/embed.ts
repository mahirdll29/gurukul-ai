const endpoint='https://generativelanguage.googleapis.com/v1beta/models';
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export async function embedTexts(texts:string[]):Promise<number[][]>{
  const model=process.env.EMBEDDING_MODEL,key=process.env.GEMINI_API_KEY;
  if(!key)throw new Error('Missing required environment variable: GEMINI_API_KEY');
  if(!model)throw new Error('Missing required environment variable: EMBEDDING_MODEL');
  if(Number(process.env.EMBEDDING_DIM||768)!==768)throw new Error('EMBEDDING_DIM must be 768.');
  const embeddings:number[][]=[];
  for(let offset=0;offset<texts.length;offset+=20){
    const batch=texts.slice(offset,offset+20);
    let response:Response|undefined;
    for(let attempt=0;attempt<5;attempt++){
      response=await fetch(`${endpoint}/${encodeURIComponent(model)}:batchEmbedContents`,{
        method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},
        body:JSON.stringify({requests:batch.map(text=>({model:`models/${model}`,content:{parts:[{text}]},embedContentConfig:{outputDimensionality:768}}))}),
        signal:AbortSignal.timeout(Number(process.env.EMBEDDING_TIMEOUT_MS||30_000)),
      });
      if(response.status!==429)break;
      if(attempt<4)await sleep(250*2**attempt);
    }
    if(!response?.ok)throw new Error(`Gemini embedding request failed (${response?.status||'network error'}).`);
    const result:any=await response.json();
    const batchEmbeddings=result.embeddings?.map((item:any)=>item.values) as number[][]|undefined;
    if(!batchEmbeddings||batchEmbeddings.length!==batch.length)throw new Error('Gemini returned an incomplete embedding batch.');
    if(batchEmbeddings.some(vector=>vector.length!==768))throw new Error('Gemini embedding dimension mismatch; expected 768.');
    embeddings.push(...batchEmbeddings);
  }
  return embeddings;
}

export async function embedText(text:string){return (await embedTexts([text]))[0];}

export async function checkEmbedding(){
  if(!process.env.GEMINI_API_KEY)throw new Error('Missing required environment variable: GEMINI_API_KEY');
  if(!process.env.EMBEDDING_MODEL)throw new Error('Missing required environment variable: EMBEDDING_MODEL');
  const vector=await embedText('test');
  if(vector.length!==768)throw new Error(`Embedding model returned ${vector.length} dimensions; expected 768.`);
}
