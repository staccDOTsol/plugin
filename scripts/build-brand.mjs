import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
const source = await readFile(new URL('../public/captain-hook.svg', import.meta.url));
const image = sharp(source, { density: 600 }).resize(512, 512).png();
await image.clone().toFile(new URL('../public/captain-hook-token.png', import.meta.url).pathname);
await image.clone().toFile(new URL('../../plague/frontend/assets/captain-hook-token.png', import.meta.url).pathname);
console.log('Captain Hook token artwork generated at 512×512.');
