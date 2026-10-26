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

const GLOBAL = 'global';

function planSync(commands, { commandGuild, guildsOf }) {
  if (commandGuild) {
    return { global: undefined, guilds: new Map([[commandGuild, toDiscordCommands(commands)]]) };
  }

  const everywhere = [];
  const scoped = new Map();
  commands.forEach((command) => {
    const ids = guildsOf(command);
    if (!ids.length) {
      everywhere.push(command);
      return;
    }
    ids.forEach(id => scoped.set(id, [...(scoped.get(id) || []), command]));
  });

  return {
    global: toDiscordCommands(everywhere),
    guilds: new Map([...scoped].map(([id, list]) => [id, toDiscordCommands(list)])),
  };
}

function reconcile(plan, synced) {
  const updates = [];
  const consider = (target, payload) => {
    const hash = hashCommands(payload);
    if (synced.get(target) !== hash) updates.push({ target, payload, hash });
  };

  if (plan.global !== undefined) consider(GLOBAL, plan.global);
  plan.guilds.forEach((payload, id) => consider(id, payload));

  const clears = [...synced.keys()].filter(target => target !== GLOBAL && !plan.guilds.has(target));
  return { updates, clears };
}

function commandText(prefix, command, options = []) {
  const values = new Map((options || []).map(option => [option.name, option.value]));
  const args = (command.args || [])
    .filter(arg => values.has(arg.name))
    .map(arg => String(values.get(arg.name)));
  return [`${prefix}${command.name}`, ...args].join(' ');
}

module.exports = {
  GLOBAL,
  MAX_COMMANDS,
  commandText,
  hashCommands,
  planSync,
  reconcile,
  toDiscordCommands,
};
