const fs = require('fs');
const path = require('path');

// Simple build: copy public/ to dist/
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDir('public', 'dist');
console.log('✓ Build complete: public/ → dist/');

// List output
const files = fs.readdirSync('dist');
files.forEach(f => {
  const size = (fs.statSync(path.join('dist', f)).size / 1024).toFixed(1);
  console.log(`  ${f}: ${size} KB`);
});
