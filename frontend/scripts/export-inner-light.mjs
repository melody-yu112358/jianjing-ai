import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=process.cwd();
const candidates=(await fs.readdir(path.join(root,'node_modules/.pnpm'))).filter(n=>n.startsWith('esbuild@')).sort().reverse();
if(!candidates.length)throw Error('The installed build tool is unavailable');
const require=createRequire(import.meta.url),esbuild=require(path.join(root,'node_modules/.pnpm',candidates[0],'node_modules/esbuild'));
const out=process.argv[2];if(!out||!path.isAbsolute(out))throw Error('Pass an absolute output HTML path');
const bundle=await esbuild.build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import Home from './app/page';createRoot(document.getElementById('root')).render(React.createElement(Home));",resolveDir:root,loader:'tsx'},absWorkingDir:root,bundle:true,write:false,format:'iife',minify:true,platform:'browser',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'standalone-navigation',setup(build){build.onLoad({filter:/app\/page\.tsx$/},async args=>({contents:(await fs.readFile(args.path,'utf8')).replace('href="/"','href="#"').replace('href="/lab"','href="https://jianjing-state-flow.haibara0422.chatgpt.site"'),loader:'tsx'}));}}]});
async function cssFiles(dir){let all=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())all.push(...await cssFiles(f));else if(e.name.endsWith('.css'))all.push(f);}return all;}
const styles=await cssFiles(path.join(root,'dist/client'));
if(!styles.length)throw Error('Build the site before exporting');
const css=(await Promise.all(styles.map(f=>fs.readFile(f,'utf8')))).join('\n');
let js=bundle.outputFiles[0].text.replaceAll('</script','<\\/script');
for(const file of ['baltic-sea.mp3']){const bytes=await fs.readFile(path.join(root,'public/audio',file));js=js.replaceAll('/audio/'+file,'data:audio/mpeg;base64,'+bytes.toString('base64'));}
await fs.mkdir(path.dirname(out),{recursive:true});
await fs.writeFile(out,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>渐静 · 光丝生命体</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);
console.log(JSON.stringify({file:out,bytes:(await fs.stat(out)).size,externalAssets:false}));
