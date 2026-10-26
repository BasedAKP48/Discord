const crypto = require('crypto');
const { Constants } = require('eris');

const { ApplicationCommandOptionTypes, ApplicationCommandTypes } = Constants;

const MAX_COMMANDS = 100;
const OPTION_TYPES = {
  string: ApplicationCommandOptionTypes.STRING,
  integer: ApplicationCommandOptionTypes.INTEGER,
  boolean: ApplicationCommandOptionTypes.BOOLEAN,
};
const EXTRAS = ['dmPermission', 'defaultMemberPermissions', 'nsfw'];

function toDiscordCommand(command) {
  const extras = command.discord || {};
  const payload = {
    name: command.name,
    description: command.description,
    type: ApplicationCommandTypes.CHAT_INPUT,
    options: (command.args || []).map(arg => ({
      name: arg.name,
      description: arg.description,
      type: OPTION_TYPES[arg.type],
      required: arg.required === true,
    })),
  };
  EXTRAS.forEach((key) => {
    if (extras[key] !== undefined) payload[key] = extras[key];
  });
  return payload;
}

function toDiscordCommands(commands) {
  return commands
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_COMMANDS)
    .map(toDiscordCommand);
}

function hashCommands(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function commandText(prefix, command, options = []) {
  const values = new Map((options || []).map(option => [option.name, option.value]));
  const args = (command.args || [])
    .filter(arg => values.has(arg.name))
    .map(arg => String(values.get(arg.name)));
  return [`${prefix}${command.name}`, ...args].join(' ');
}

module.exports = {
  MAX_COMMANDS,
  commandText,
  hashCommands,
  toDiscordCommands,
};
