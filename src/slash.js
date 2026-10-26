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

const isText = arg => arg.type === 'string';

function commandText(prefix, command, options = []) {
  const values = new Map((options || []).map(option => [option.name, option.value]));
  const args = command.args || [];
  const words = [];
  for (let index = 0; index < args.length;) {
    if (!isText(args[index])) {
      if (values.has(args[index].name)) words.push(String(values.get(args[index].name)));
      index += 1;
    } else {
      let stop = index;
      while (stop < args.length && isText(args[stop])) stop += 1;
      const run = args.slice(index, stop);
      const last = run.map(arg => values.has(arg.name)).lastIndexOf(true);
      if (last !== -1) {
        words.push(run.slice(0, last + 1)
          .map(arg => (values.has(arg.name) ? String(values.get(arg.name)) : ''))
          .join(' | ')
          .trim());
      }
      index = stop;
    }
  }
  return [`${prefix}${command.name}`, ...words].join(' ');
}

function commandArgs(command, options) {
  const values = new Map((options || []).map(option => [option.name, option.value]));
  return (command.args || [])
    .filter(arg => values.has(arg.name))
    .reduce((args, arg) => ({ ...args, [arg.name]: values.get(arg.name) }), {});
}

module.exports = {
  GLOBAL,
  MAX_COMMANDS,
  commandArgs,
  commandText,
  hashCommands,
  planSync,
  reconcile,
  toDiscordCommands,
};
