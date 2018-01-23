const Command = require('./command');

const alias = 'default';

class Default extends Command {
  runCommand() {
    throw new Error('Command does not exist');
  }
}

module.exports = new Default({ alias });
