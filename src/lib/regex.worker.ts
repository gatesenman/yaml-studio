import { scanRegex } from './regex'
self.onmessage = (event: MessageEvent<{source:string;query:string}>) => {
  try { self.postMessage({hits:scanRegex(event.data.source,event.data.query)}) }
  catch(error){ self.postMessage({error:String(error)}) }
}
