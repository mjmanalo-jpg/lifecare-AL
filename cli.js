#!/usr/bin/env node

/**
 * Assisted Living Portal - Global CLI
 * Run: node cli.js [command]
 * Or: npm run cli [command]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = __dirname;
const frontendPath = path.join(projectRoot, 'apps', 'frontend');

// Commands
const commands = {
  start: () => {
    console.log('🚀 Starting dev server...');
    process.chdir(frontendPath);
    execSync('npm run dev', { stdio: 'inherit' });
  },

  build: () => {
    console.log('🔨 Building...');
    process.chdir(frontendPath);
    execSync('npm run build', { stdio: 'inherit' });
  },

  test: () => {
    console.log('✅ Testing...');
    process.chdir(frontendPath);
    execSync('npm test', { stdio: 'inherit' });
  },

  clean: () => {
    console.log('🧹 Cleaning...');
    process.chdir(frontendPath);
    execSync('rm -rf .next node_modules', { stdio: 'inherit' });
    console.log('✅ Clean done');
  },

  install: () => {
    console.log('📦 Installing...');
    process.chdir(frontendPath);
    execSync('npm install', { stdio: 'inherit' });
  },

  git: () => {
    console.log('📝 Git commit & push...');
    const msg = process.argv[3] || 'Auto commit';
    process.chdir(projectRoot);
    execSync(`git add -A`, { stdio: 'inherit' });
    execSync(`git commit -m "${msg}"`, { stdio: 'inherit' });
    execSync(`git push`, { stdio: 'inherit' });
    console.log('✅ Pushed');
  },

  status: () => {
    console.log('📊 Project Status:\n');
    try {
      process.chdir(projectRoot);
      console.log('Git status:');
      execSync('git status --short', { stdio: 'inherit' });
    } catch (e) {}
    console.log('\nServer running on: http://localhost:3000');
  },

  help: () => {
    console.log(`
╔═══════════════════════════════════════╗
║  ASSISTED LIVING PORTAL - CLI         ║
╚═══════════════════════════════════════╝

COMMANDS:
  start       - Start dev server
  build       - Build for production
  test        - Run tests
  clean       - Clean build & node_modules
  install     - Install dependencies
  git [msg]   - Commit & push (default msg: "Auto commit")
  status      - Show project status
  help        - Show this help

USAGE:
  node cli.js start
  node cli.js build
  node cli.js git "My message"
    `);
  }
};

// Run
const cmd = process.argv[2] || 'help';
if (commands[cmd]) {
  commands[cmd]();
} else {
  console.log(`❌ Unknown command: ${cmd}`);
  commands.help();
}
