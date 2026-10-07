import { SourceMapConsumer } from 'source-map';
const response = await fetch('https://captainhook.fun/_next/static/chunks/pages/_app-b46cdc3062032667.js.map');
if (!response.ok) throw new Error(`Source map HTTP ${response.status}`);
const consumer = await new SourceMapConsumer(await response.json());
const position = consumer.originalPositionFor({ line: 108, column: 16162 });
const source = consumer.sourceContentFor(position.source, true);
console.log(JSON.stringify({ ...position, context: source?.split('\n').slice(Math.max(0, position.line - 12), position.line + 12) }, null, 2));
consumer.destroy();
