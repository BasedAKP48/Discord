const admin = require('firebase-admin');
const serviceAccount = require("./serviceAccount.json");
const Eris = require('eris');
const Promise = require('bluebird');
const inquirer = require('inquirer');
let cid, token, name, bot;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
});

const rootRef = admin.database().ref();

try {
  cid = require('./cid.json');
} catch (e) {
  let fs = require('fs');
  let clientRef = rootRef.child('config/clients').push();
  cid = clientRef.key;
  fs.writeFileSync('./cid.json', JSON.stringify(cid), {encoding: 'UTF-8'});
}

rootRef.child(`config/clients/${cid}`).on('value', (d) => {
  let config = d.val();

  if(!config || !d.hasChild('token')) {
    prompt(d.ref);
    return;
  }

  if(bot) {
    if(config.token !== token) {
      // we need to disconnect the bot and connect with our new token.
      console.log("Disconnecting")
      bot.disconnect({reconnect: false});
      bot = null;
    }

    if(config.name !== name) {
      name = config.name; // TODO: rename
    }
  }

  token = config.token;
  if (!bot) initializeBot();
});

function initializeBot(options) {
  bot = new Eris(token, {
    // options will go here later.
  });
  
  bot.on('error', (msg) => console.log("Error: ",msg));
  
  bot.on('ready', () => {
    console.log('connected to Discord');
    bot.editStatus("online", {
      name: 'with code.',
      type: 0,
      url: 'https://akp48.akpwebdesign.com/'
    });
  });

  bot.on('messageCreate', (msg) => {
    handleMessage(msg);
  });

  rootRef.child(`clients/${cid}`).on('child_added', (d) => {
    let msg = d.val();
    if(msg.msgType.toLowerCase() === 'chatmessage') {
      return bot.sendChannelTyping(msg.channel).then(() => {
        return Promise.delay(750).then(() => {
          if(msg.extra_client_info && msg.extra_client_info.discord_embed) {
            return bot.createMessage(msg.channel, {embed: msg.extra_client_info.discord_embed});
          }
          return bot.createMessage(msg.channel, msg.text);
        });
      }).then(() => {
        return d.ref.remove();
      });
    }
  });

  bot.connect();
}

function handleMessage(msg) {
  if(msg.author.id == bot.user.id) {
    console.log(`<=== ${msg.author.username}#${msg.author.discriminator} | ${msg.channel.guild.name}/${msg.channel.name}: ${msg.content}`);
    return;
  }
  let BasedAKP48Msg = {
    cid: cid,
    uid: msg.author.id,
    text: msg.content,
    channel: msg.channel.id,
    msgType: 'chatMessage',
    timeReceived: msg.timestamp
  };

  rootRef.child('pendingMessages').push().set(BasedAKP48Msg);
  console.log(`===> ${msg.author.username}#${msg.author.discriminator} | ${msg.channel.guild.name}/${msg.channel.name}: ${msg.content}`);
}

function prompt(ref) {
  inquirer.prompt([{name: 'token', message: "Enter your bot's discord token:"}]).then(prompt => {
    if (prompt.token) {
      ref.update({token: prompt.token});
    }
  });
}