import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

// QA serves the same www/ snapshot that Electron packages, including offline assets.
export default defineConfig({
  root:fileURLToPath(new URL('./www/',import.meta.url)),
  server:{host:'0.0.0.0',port:4173,strictPort:true,allowedHosts:['terminal.local']},
  plugins:[{
    name:'tau-desktop-entry',
    configureServer(server){server.middlewares.use((req,res,next)=>{
      if(req.url==='/'){res.writeHead(302,{location:'/index.html?steam=1&premium=1'});res.end();}
      else next();
    });},
  }],
});
