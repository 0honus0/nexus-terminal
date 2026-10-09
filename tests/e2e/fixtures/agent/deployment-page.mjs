import http from 'node:http';

const port = Number(process.env.NEXUS_E2E_DEPLOYMENT_PAGE_PORT ?? '29202');
let deployed = false;
let deployments = 0;
const server = http.createServer((request, response) => {
	if (request.method === 'GET' && request.url === '/state') {
		response.setHeader('Content-Type', 'application/json');
		response.end(JSON.stringify({ deployed, deployments, release: 'fixture-v1' }));
		return;
	}
	if (request.method === 'POST' && request.url === '/deploy') {
		deployed = true;
		deployments += 1;
		response.setHeader('Content-Type', 'application/json');
		response.end(JSON.stringify({ deployed, deployments, release: 'fixture-v1' }));
		return;
	}
	if (request.method === 'GET' && request.url === '/') {
		response.setHeader('Content-Type', 'text/html; charset=utf-8');
		response.end(
			`<!doctype html><html lang="en"><title>Isolated Deployment</title><main><h1>Fixture release fixture-v1</h1><p id="status" role="status">Not deployed</p><button type="button">Deploy fixture-v1</button></main><script>const status=document.querySelector('#status');const show=s=>{status.textContent=s.deployed?'Deployed fixture-v1':'Not deployed'};fetch('/state').then(r=>r.json()).then(show);document.querySelector('button').addEventListener('click',async()=>{show(await(await fetch('/deploy',{method:'POST'})).json())});</script></html>`,
		);
		return;
	}
	response.writeHead(404).end();
});
server.listen(port, '127.0.0.1');

const stop = () => {
	server.closeAllConnections();
	server.close();
};

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
