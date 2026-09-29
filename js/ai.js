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
  return {
    type:'object',
    properties:{
      items:{
        type:'array',
        items:{
          type:'object',
          properties:{
            index:{type:'integer'},
            ipaUS:{type:'string'},
            ipaUK:{type:'string'},
            meaningVi:{type:'string'},
            partOfSpeech:{type:'string'},
            exampleEn:{type:'string'},
            exampleVi:{type:'string'}
          },
          required:['index','ipaUS','ipaUK','meaningVi','partOfSpeech','exampleEn','exampleVi'],
          additionalProperties:false
        }
      }
    },
    required:['items'],
    additionalProperties:false
  };
}

function vocabPrompt(words){
  const targets=words.map((w,i)=>`${i}. ${w}`).join('\n');
  return `You create high-quality English vocabulary flashcards for a Vietnamese adult learner.\nProcess every item in this numbered list:\n${targets}\n\nReturn one JSON object containing an items array.\nRules:\n- Return exactly one item for every input index and preserve each index.\n- ipaUS = accurate General American IPA, including / /.\n- ipaUK = accurate modern Standard British IPA, including / /.\n- meaningVi = short natural Vietnamese meaning; max 2 closely related common meanings.\n- partOfSpeech = concise English part of speech.\n- exampleEn = one short natural English sentence using the intended sense.\n- exampleVi = natural Vietnamese translation of exampleEn.\n- Do not add markdown or explanation.`;
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
    const i=Number(x.index);
    if(!Number.isInteger(i)||i<0||i>=n)continue;
    const item={
      ipaUS:String(x.ipaUS||'').trim(),
      ipaUK:String(x.ipaUK||'').trim(),
      meaningVi:String(x.meaningVi||'').trim(),
      partOfSpeech:String(x.partOfSpeech||'').trim(),
      exampleEn:String(x.exampleEn||'').trim(),
      exampleVi:String(x.exampleVi||'').trim()
    };
    if(item.meaningVi&&item.ipaUS&&item.ipaUK&&item.exampleEn)out[i]=item;
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
