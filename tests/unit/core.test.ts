import {describe,expect,it} from 'vitest';
import JSZip from 'jszip';
import {retryDelayMs} from '../../server/src/jobs/queue.js';
import {reciprocalRankFusion} from '../../server/src/core/retrieval.js';
import {nextReviewSchedule} from '../../server/src/routes/study.js';
import {filterKAnonymousTopics,tokenizeTopics} from '../../server/src/core/analytics.js';
import {calculateStorageCost} from '../../server/src/core/storage-cost.js';
import {sha256,validateMagicBytes} from '../../server/src/core/hash.js';
import {unitDiff} from '../../server/src/core/diff.js';
import {parseDocument} from '../../server/src/parsers/index.js';

describe('pure project behavior',()=>{
  it('computes bounded exponential retry backoff plus jitter',()=>{expect(retryDelayMs(0,()=>0)).toBe(5000);expect(retryDelayMs(2,()=>0.5)).toBe(22000);expect(retryDelayMs(20,()=>1)).toBe(360000);});
  it('fuses keyword and vector rankings with RRF and combines signals',()=>{const a:any={unit_id:'a',signals:[],score:0},b:any={unit_id:'b',signals:[],score:0};const result=reciprocalRankFusion([[a,b],[b]],2);expect(result[0].unit_id).toBe('b');expect(result[0].signals).toEqual(['vector','keyword']);});
  it('schedules Leitner review for missed and existing correct answers',()=>{const now=Date.UTC(2026,0,1);expect(nextReviewSchedule(3,false,true,now)?.box).toBe(1);expect(nextReviewSchedule(1,true,true,now)?.dueAt.getTime()).toBe(now+3*86400000);expect(nextReviewSchedule(1,true,false,now)).toBeNull();});
  it('tokenizes topics and suppresses terms below k-anonymity',()=>{expect(tokenizeTopics('Why, does the CPU scale?')).toEqual(['cpu','scale']);const terms=new Map([['a',['cpu','memory']],['b',['cpu']],['c',['memory']]]);expect(filterKAnonymousTopics(terms,2)).toEqual([{term:'cpu',count:2},{term:'memory',count:2}]);expect(filterKAnonymousTopics(terms,3)).toEqual([]);});
  it('calculates a simulated storage cost estimate',()=>{const c=calculateStorageCost({logicalBytes:2**30,physicalBytes:2**30,coldEligibleBytes:2**29,hotUsdPerGbMonth:0.02,coldUsdPerGbMonth:0.005});expect(c.naiveMonthlyUsd).toBeCloseTo(0.02);expect(c.tieredMonthlyUsd).toBeCloseTo(0.0125);expect(c.simulated).toBe(true);});
  it('hashes bytes and validates file signatures',()=>{expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');expect(validateMagicBytes('pdf',Buffer.from('%PDF-1.7'))).toBe(true);expect(validateMagicBytes('pdf',Buffer.from('PKxx'))).toBe(false);expect(validateMagicBytes('docx',Buffer.from('PK\x03\x04'))).toBe(true);});
  it('diffs ordered document units',()=>{const result=unitDiff([{locator:'p1',text:'a',text_hash:'a'},{locator:'p2',text:'b',text_hash:'b'}],[{locator:'p1',text:'a',text_hash:'a'},{locator:'p3',text:'c',text_hash:'c'}]);expect(result.map(x=>x.type)).toEqual(['same','removed','added']);});
  it('extracts DOCX paragraphs and PPTX slides in source order',async()=>{
    const docx=new JSZip();docx.file('word/document.xml','<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>First paragraph</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>');const docxBytes=await docx.generateAsync({type:'nodebuffer'});const paragraphs=await parseDocument('docx',docxBytes);expect(paragraphs.map(x=>x.text)).toEqual(['First paragraph','Second paragraph']);
    const pptx=new JSZip();pptx.file('ppt/presentation.xml','<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId r:id="rId1"/><p:sldId r:id="rId2"/></p:sldIdLst></p:presentation>');pptx.file('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>');pptx.file('ppt/slides/slide1.xml','<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:t>Slide one</a:t></p:sld>');pptx.file('ppt/slides/slide2.xml','<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:t>Slide two</a:t></p:sld>');const pptxBytes=await pptx.generateAsync({type:'nodebuffer'});const slides=await parseDocument('pptx',pptxBytes);expect(slides.map(x=>x.text)).toEqual(['Slide one','Slide two']);
  });
});
