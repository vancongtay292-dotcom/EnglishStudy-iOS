import {loadSecret,loadSetting,saveSetting} from './crypto.js';
import {parseJsonFromText,sleep} from './utils.js';
import {blobFromInline} from './audio.js';

const cooldownKey=(kind,i)=>`cooldown:${kind}:${i}`;
function lines(s){return String(s||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i)}

async function post(url,key,body,provider){
  const headers={'Content-Type':'application/json'};
  if(provider==='gemini')headers['x-goog-api-key']=key;
  else headers.Authorization=`Bearer ${key}`;
  const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
  const raw=await r.text();
  if(!r.ok){
    const e=new Error(`${provider} HTTP ${r.status}: ${raw.slice(0,700)}`);
    e.status=r.status;
    e.retryAfter=Number(r.headers.get('retry-after')||0);
    e.raw=raw;
    throw e;
  }
  try{return JSON.parse(raw)}catch{throw new Error(`${provider} trả phản hồi không phải JSON`)}
}

async function projectPool(kind){
  const secret=await loadSecret(kind==='vocab'?'vocabKeys':'speechKeys');
  const arr=lines(secret),now=Date.now(),usable=[];
  for(let i=0;i<arr.length;i++){
    const until=Number(await loadSetting(cooldownKey(kind,i),0));
    if(until<=now)usable.push({key:arr[i],index:i});
  }
  return usable;
}

async function markCooldown(kind,index,e){
  if(e.status!==429&&e.status!==503)return;
  const sec=e.retryAfter>0?e.retryAfter:3600;
  await saveSetting(cooldownKey(kind,index),Date.now()+sec*1000);
}

function geminiText(response){
  const parts=response?.candidates?.[0]?.content?.parts||[];
  for(const p of parts)if(p.text)return p.text;
  throw new Error('Gemini không trả text');
}
function geminiInline(response){
  const parts=response?.candidates?.[0]?.content?.parts||[];
  for(const p of parts){const d=p.inlineData||p.inline_data;if(d?.data)return d}
  throw new Error('Gemini không trả audio');
}

function vocabSchema(){
  const example={type:'object',properties:{en:{type:'string'},vi:{type:'string'}},required:['en','vi'],additionalProperties:false};
  const pronunciation={type:'object',properties:{uk:{type:'string'},us:{type:'string'}},required:['uk','us'],additionalProperties:false};
  const synonym={type:'object',properties:{word:{type:'string'},type:{type:'string'},meaningVi:{type:'string'},pronunciation},required:['word','type','meaningVi','pronunciation'],additionalProperties:false};
  const meaning={type:'object',properties:{vi:{type:'string'},example,synonyms:{type:'array',items:synonym}},required:['vi','example','synonyms'],additionalProperties:false};
  const pos={type:'object',properties:{type:{type:'string'},meanings:{type:'array',items:meaning}},required:['type','meanings'],additionalProperties:false};
  const family={type:'object',properties:{type:{type:'string'},word:{type:'string'},meaningVi:{type:'string'},pronunciation,example},required:['type','word','meaningVi','pronunciation','example'],additionalProperties:false};
  return {type:'object',properties:{items:{type:'array',items:{type:'object',properties:{
    index:{type:'integer'},ipaUS:{type:'string'},ipaUK:{type:'string'},meaningVi:{type:'string'},partOfSpeech:{type:'string'},exampleEn:{type:'string'},exampleVi:{type:'string'},
    partsOfSpeech:{type:'array',items:pos},wordFamily:{type:'array',items:family},synonyms:{type:'array',items:synonym}
  },required:['index','ipaUS','ipaUK','meaningVi','partOfSpeech','exampleEn','exampleVi','partsOfSpeech','wordFamily','synonyms'],additionalProperties:false}}},required:['items'],additionalProperties:false};
}

function vocabPrompt(words){
  const targets=words.map((w,i)=>`${i}. ${w}`).join('\n');
  return `You create high-quality English vocabulary data for a Vietnamese adult learner.\nProcess every item:\n${targets}\n\nReturn one JSON object containing an items array.\nRules:\n- Exactly one item per input index.\n- ipaUS = accurate General American IPA including / /. ipaUK = modern Standard British IPA including / /.\n- Keep legacy fields meaningVi, partOfSpeech, exampleEn, exampleVi concise and useful. meaningVi is the primary/common meaning.\n- partsOfSpeech: include every common useful part of speech the exact input word genuinely has. Each part has its own meanings. Each meaning has Vietnamese meaning and one short natural English example plus Vietnamese translation. Do not invent rare senses just to add categories.\n- synonyms: top-level contains 3-5 useful synonyms for the primary/common sense for backward-compatible display. ALSO each partsOfSpeech.meanings item has its own 2-4 synonyms appropriate ONLY to that exact sense. Each synonym has word, type, Vietnamese meaning, and UK/US IPA. Do not mix synonyms across senses or include loosely related words.
- wordFamily: include only common, natural members of the same morphological word family, prioritizing noun, verb, adjective and adverb when they genuinely exist. Do not fabricate a form to fill all four categories.\n- Every wordFamily member must contain type, word, Vietnamese meaning, pronunciation.uk, pronunciation.us, and an example {en,vi}. IPA strings include / /.\n- A family member may equal the input word when it represents a useful family relation. Avoid duplicate family entries with the same word and type.\n- Examples must demonstrate the stated part of speech/meaning.\n- No markdown or explanation.`;
}

async function groqVocabulary(words,prompt,key,model){
  const url='https://api.groq.com/openai/v1/chat/completions';
  const schema=vocabSchema();
  const common={
    model,
    messages:[
      {role:'system',content:'Return only the vocabulary data requested by the user.'},
      {role:'user',content:prompt}
    ],
    temperature:0.1,
    reasoning_effort:'low'
  };

  // Preferred path: strict Structured Outputs. GPT-OSS 20B supports json_schema.
  try{
    const resp=await post(url,key,{
      ...common,
      response_format:{
        type:'json_schema',
        json_schema:{name:'vocabulary_batch',strict:true,schema}
      }
    },'groq');
    return parseJsonFromText(resp?.choices?.[0]?.message?.content||'');
  }catch(e){
    // Groq can return HTTP 400 when JSON validation fails during generation.
    // Retry once without server-side JSON validation and parse the JSON locally.
    const raw=String(e.raw||e.message||'');
    const isGenerationJsonFailure=e.status===400 && /failed_generation|json|validate|validation/i.test(raw);
    if(!isGenerationJsonFailure)throw e;
    const resp=await post(url,key,{
      ...common,
      messages:[
        {role:'system',content:'Output one valid JSON object only. No markdown, no comments, no prose outside JSON.'},
        {role:'user',content:prompt+'\nThe root object must contain only the key "items".'}
      ]
    },'groq');
    return parseJsonFromText(resp?.choices?.[0]?.message?.content||'');
  }
}

export async function enrichBatch(words){
  const textModel=await loadSetting('textModel','gemini-3.1-flash-lite');
  const prompt=vocabPrompt(words);
  const schema=vocabSchema();
  const body={
    contents:[{parts:[{text:prompt}]}],
    generationConfig:{
      temperature:0.1,
      responseMimeType:'application/json',
      responseJsonSchema:schema
    }
  };

  const pool=await projectPool('vocab');
  let last;
  for(const p of pool){
    try{
      const resp=await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(textModel)}:generateContent`,p.key,body,'gemini');
      const root=parseJsonFromText(geminiText(resp));
      const normalized=normalizeItems(root.items,words.length);
      if(normalized.every(Boolean))return normalized;
      throw new Error('Gemini trả thiếu một hoặc nhiều từ trong batch');
    }catch(e){
      last=e;
      await markCooldown('vocab',p.index,e);
      if(![429,500,502,503,504].includes(e.status))break;
    }
  }

  const groqEnabled=Boolean(await loadSetting('groqEnabled',false));
  const groqKey=groqEnabled?await loadSecret('groqKey'):'';
  if(groqKey){
    try{
      const model=await loadSetting('groqModel','openai/gpt-oss-20b');
      const root=await groqVocabulary(words,prompt,groqKey,model);
      const normalized=normalizeItems(root.items,words.length);
      if(normalized.every(Boolean))return normalized;
      throw new Error('Groq trả thiếu một hoặc nhiều từ trong batch');
    }catch(e){last=e}
  }

  throw last||new Error('Chưa cấu hình AI cho từ vựng');
}

function normalizeItems(items,n){
  const out=Array(n).fill(null);
  for(const x of(Array.isArray(items)?items:[])){
    const i=Number(x.index); if(!Number.isInteger(i)||i<0||i>=n)continue;
    const cleanExample=e=>({en:String(e?.en||'').trim(),vi:String(e?.vi||'').trim()});
    const partsOfSpeech=(Array.isArray(x.partsOfSpeech)?x.partsOfSpeech:[]).map(p=>({
      type:String(p?.type||'').trim(), meanings:(Array.isArray(p?.meanings)?p.meanings:[]).map(m=>({vi:String(m?.vi||'').trim(),example:cleanExample(m?.example),synonyms:(Array.isArray(m?.synonyms)?m.synonyms:[]).map(a=>({word:String(a?.word||'').trim(),type:String(a?.type||'').trim(),meaningVi:String(a?.meaningVi||'').trim(),pronunciation:{uk:String(a?.pronunciation?.uk||'').trim(),us:String(a?.pronunciation?.us||'').trim()}})).filter(a=>a.word)})).filter(m=>m.vi)
    })).filter(p=>p.type&&p.meanings.length);
    const wordFamily=(Array.isArray(x.wordFamily)?x.wordFamily:[]).map(f=>({
      type:String(f?.type||'').trim(),word:String(f?.word||'').trim(),meaningVi:String(f?.meaningVi||'').trim(),
      pronunciation:{uk:String(f?.pronunciation?.uk||'').trim(),us:String(f?.pronunciation?.us||'').trim()},example:cleanExample(f?.example)
    })).filter(f=>f.type&&f.word&&f.meaningVi);
    const synonyms=(Array.isArray(x.synonyms)?x.synonyms:[]).map(a=>({word:String(a?.word||'').trim(),type:String(a?.type||'').trim(),meaningVi:String(a?.meaningVi||'').trim(),pronunciation:{uk:String(a?.pronunciation?.uk||'').trim(),us:String(a?.pronunciation?.us||'').trim()}})).filter(a=>a.word&&a.meaningVi);
    const item={ipaUS:String(x.ipaUS||'').trim(),ipaUK:String(x.ipaUK||'').trim(),meaningVi:String(x.meaningVi||'').trim(),partOfSpeech:String(x.partOfSpeech||'').trim(),exampleEn:String(x.exampleEn||'').trim(),exampleVi:String(x.exampleVi||'').trim(),partsOfSpeech,wordFamily,synonyms};
    if(item.meaningVi&&item.ipaUS&&item.ipaUK&&item.exampleEn&&partsOfSpeech.length)out[i]=item;
  }
  return out;
}

export async function generateSpeech(text,accent='US',voice='Kore',purpose='vocabulary'){
  const ttsModel=await loadSetting('ttsModel','gemini-3.1-flash-tts-preview');
  const lang=accent==='UK'?'en-GB':'en-US';
  const accentName=accent==='UK'?'British English':'American English';
  const prompt=purpose==='dialogue'
    ?`Read only this dialogue line naturally in ${accentName}. Do not add or omit words. Text: ${text}`
    :`Pronounce only this English word or phrase clearly in ${accentName}, learner-friendly and natural. Do not add explanation. Text: ${text}`;
  const body={
    contents:[{parts:[{text:prompt}]}],
    generationConfig:{
      responseModalities:['AUDIO'],
      speechConfig:{languageCode:lang,voiceConfig:{prebuiltVoiceConfig:{voiceName:voice}}}
    }
  };
  const pool=await projectPool('speech');
  let last;
  for(const p of pool){
    try{
      const resp=await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ttsModel)}:generateContent`,p.key,body,'gemini');
      return blobFromInline(geminiInline(resp));
    }catch(e){
      last=e;
      await markCooldown('speech',p.index,e);
      if(![429,500,502,503,504].includes(e.status))break;
      await sleep(250);
    }
  }
  throw last||new Error('Chưa cấu hình Gemini Speech Project Pool');
}

export async function testAiConfig(){
  const p=await projectPool('vocab');
  if(!p.length)return 'Chưa có Gemini Vocabulary Project';
  return `Đã cấu hình ${p.length} Gemini Vocabulary Project`;
}


function phrasalSchema(){
  const pronunciation={type:'object',properties:{uk:{type:'string'},us:{type:'string'}},required:['uk','us'],additionalProperties:false};
  const example={type:'object',properties:{en:{type:'string'},vi:{type:'string'}},required:['en','vi'],additionalProperties:false};
  const component={type:'object',properties:{word:{type:'string'},type:{type:'string'},meaningVi:{type:'string'},role:{type:'string'}},required:['word','type','meaningVi','role'],additionalProperties:false};
  const synonym={type:'object',properties:{phrase:{type:'string'},meaningVi:{type:'string'},pronunciation},required:['phrase','meaningVi','pronunciation'],additionalProperties:false};
  const meaning={type:'object',properties:{vi:{type:'string'},explanation:{type:'string'},example,synonyms:{type:'array',items:synonym}},required:['vi','explanation','example','synonyms'],additionalProperties:false};
  return {type:'object',properties:{items:{type:'array',items:{type:'object',properties:{index:{type:'integer'},phraseType:{type:'string'},ipaUK:{type:'string'},ipaUS:{type:'string'},components:{type:'array',items:component},meanings:{type:'array',items:meaning}},required:['index','phraseType','ipaUK','ipaUS','components','meanings'],additionalProperties:false}}},required:['items'],additionalProperties:false};
}
function phrasalPrompt(phrases){const targets=phrases.map((w,i)=>`${i}. ${w}`).join('\n');return `Create high-quality English phrasal-verb data for a Vietnamese adult learner.\nProcess every item:\n${targets}\nReturn JSON only. Rules:\n- Treat the whole phrase as one lexical unit; never derive its final meaning by mechanically adding component meanings.\n- ipaUK and ipaUS are IPA for the WHOLE phrase, including / /.\n- components: analyze each written component with its part of speech, basic Vietnamese meaning, and its role in this phrasal verb.\n- meanings: include common useful senses of the WHOLE phrase. Each sense has Vietnamese meaning, a concise explanation, one natural English example and Vietnamese translation.\n- For each sense include 2-4 genuinely synonymous words or phrases when available. Each synonym includes Vietnamese meaning and UK/US IPA for the whole synonym phrase.\n- Do not invent rare senses or false synonyms.`}
export async function enrichPhrasalBatch(phrases){
  const textModel=await loadSetting('textModel','gemini-3.1-flash-lite'),prompt=phrasalPrompt(phrases),schema=phrasalSchema();
  const body={contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.1,responseMimeType:'application/json',responseJsonSchema:schema}};
  const pool=await projectPool('vocab');let last;
  for(const p of pool){try{const resp=await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(textModel)}:generateContent`,p.key,body,'gemini');const root=parseJsonFromText(geminiText(resp));return normalizePhrasal(root.items,phrases.length)}catch(e){last=e;await markCooldown('vocab',p.index,e);if(![429,500,502,503,504].includes(e.status))break}}
  throw last||new Error('Chưa cấu hình AI cho cụm động từ');
}
function normalizePhrasal(items,n){const out=Array(n).fill(null);for(const x of(Array.isArray(items)?items:[])){const i=Number(x.index);if(!Number.isInteger(i)||i<0||i>=n)continue;const meanings=(x.meanings||[]).map(m=>({vi:String(m.vi||'').trim(),explanation:String(m.explanation||'').trim(),example:{en:String(m.example?.en||'').trim(),vi:String(m.example?.vi||'').trim()},synonyms:(m.synonyms||[]).map(a=>({phrase:String(a.phrase||'').trim(),meaningVi:String(a.meaningVi||'').trim(),pronunciation:{uk:String(a.pronunciation?.uk||'').trim(),us:String(a.pronunciation?.us||'').trim()}})).filter(a=>a.phrase)})).filter(m=>m.vi);const components=(x.components||[]).map(c=>({word:String(c.word||'').trim(),type:String(c.type||'').trim(),meaningVi:String(c.meaningVi||'').trim(),role:String(c.role||'').trim()})).filter(c=>c.word);if(x.ipaUK&&x.ipaUS&&meanings.length)out[i]={phraseType:String(x.phraseType||'Phrasal verb'),ipaUK:String(x.ipaUK).trim(),ipaUS:String(x.ipaUS).trim(),components,meanings};}return out}
