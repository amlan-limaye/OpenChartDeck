import { SYMBOLS } from '../public/iex-core.mjs';
export const EXTRA_IEX_SYMBOLS = Object.freeze(['PLTR','GDX','HOOD','IGV','SPCX','ARKG']);
export const OVERVIEW_IEX_SYMBOLS = Object.freeze([...SYMBOLS,...EXTRA_IEX_SYMBOLS]);
export const MAX_IEX_SYMBOLS=30;
export function checkedSymbols(symbols=SYMBOLS){
  if(!Array.isArray(symbols)||!symbols.length||symbols.length>MAX_IEX_SYMBOLS||new Set(symbols).size!==symbols.length||symbols.some(s=>typeof s!=='string'||!/^[A-Z][A-Z0-9]{0,9}(?:\.[A-Z])?$/.test(s)))throw Error('Invalid configured IEX symbol list.');
  return Object.freeze([...symbols]);
}
export function parseSymbolConfiguration(text){
  if(typeof text!=='string'||text.length>4096)throw Error('Invalid ticker configuration.');
  let input;try{input=JSON.parse(text);}catch{throw Error('Invalid ticker configuration.');}
  if(input?.version!==1||input.feed!=='iex'||Object.keys(input).some(k=>!['version','feed','symbols'].includes(k)))throw Error('Invalid ticker configuration.');
  const symbols=checkedSymbols(input.symbols);
  if(!OVERVIEW_IEX_SYMBOLS.every(s=>symbols.includes(s)))throw Error('Ticker configuration must preserve the existing fourteen symbols.');
  return symbols;
}
