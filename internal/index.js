const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));

const commands = new Map();

// Parse all the internal functions and commands
fs.readdirAsync(__dirname).then(files => files.forEach((file) => {
  if (file.startsWith('.') || !file.match(/\.command\.js$/)) return;
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const command = require(`./${file}`);
  command.commands.forEach((cmd) => {
    if (commands.has(cmd)) {
      console.log(`${file}:${cmd} already registered by ${commands.get(cmd).name}`);
    } else {
      commands.set(cmd, command);
    }
  });
}));

module.exports = msg => new Promise(res => res(commands.get(msg.text) || commands.get('default')));
