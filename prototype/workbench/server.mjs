// PROTOTYPE — throwaway local server for the Workbench UX decision.
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const types = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
};

createServer((request, response) => {
  const requested = new URL(request.url, "http://localhost").pathname;
  const file = requested === "/" ? "index.html" : requested.slice(1);
  const path = join(root, file);

  createReadStream(path)
    .on("open", () => {
      response.writeHead(200, { "Content-Type": types[extname(path)] ?? "text/plain" });
    })
    .on("error", () => {
      response.writeHead(404);
      response.end("Not found");
    })
    .pipe(response);
}).listen(4173, "127.0.0.1", () => {
  console.log("Workbench prototype: http://127.0.0.1:4173/?variant=A");
});
