const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const Command = require('./command');

/**
 * @type {Map<String, Command>}
 */
const commands = new Map();

// Parse all the internal functions and commands
fs.readdirAsync(__dirname).then(files => files.forEach((file) => {
  if (file.startsWith('.') || !file.match(/\.command\.js$/)) return;
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const command = require(`./${file}`);
  if (!(command instanceof Command) || command.commands.length === 0) {
    console.log('Bad command file:', file);
    return;
  }

  command.commands.forEach((cmd) => {
    cmd = cmd.toLowerCase();
    if (commands.has(cmd)) {
      console.log(`${file}:${cmd} already registered by ${commands.get(cmd).name}`);
    } else {
      commands.set(cmd, command);
    }
  });
}));

/**
 * @param {AKP48Message} message
 * @returns {Promise<Command>}
 */
function getCommand(message) {
  return Promise.resolve(commands.get(message.text.toLowerCase()) || commands.get('default'));
}

module.exports = getCommand;
