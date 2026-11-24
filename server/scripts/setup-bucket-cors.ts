import 'dotenv/config';
import { configureBucketCors, s3 } from '../src/core/storage.js';
try { await configureBucketCors(); console.log('Bucket CORS configured.'); }
catch { console.error('Could not configure bucket CORS. Check storage credentials and provider support.'); process.exitCode=1; }
finally { s3.destroy(); }
