const { App } = require('@slack/bolt');
const sound = require('sound-play');
const fs = require('fs');
const path = require('path');

// Initializes your app with your bot token and signing secret
const app = new App({
    socketMode: true,
    appToken: process.env.APP_TOKEN,
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const reply = async (cb, msg) => {
    const postAsSlackBot = process.env.POST_AS_SLACKBOT;
    if (postAsSlackBot == 'true') {
        await cb(msg);
        console.log(msg);
    } else {
        console.log(msg);
    }
}

// Missing Stuff:
// Whitelist
// Fuzzy Search + Response with similar sounds

const getDirectories = srcPath => {
    try {
        return fs.readdirSync(srcPath).filter(file => fs.statSync(path.join(srcPath, file)).isDirectory());
    } catch {
        return [ `Path does not exist: ${srcPath}` ];
    }
}
const getFiles = srcPath => {
    try {
        return fs.readdirSync(srcPath).filter(file => !fs.statSync(path.join(srcPath, file)).isDirectory());
    } catch {
        return [ `Path does not exist: ${srcPath}` ];
    }
}
    
(async () => {
    const playRegex = /^(play)\s+([^\s]*)/;
    const listRegex = /^(play list|play folders)(\s+|)(.*)/;

    await app.start(process.env.PORT || 3009);

    app.message('knock knock', async ({ message, say }) => {
        await reply(say, `_Who's there?_`);
        sound.play("sounds/kungfury/knockles.mp3");
    })

    app.message('play help', async ({ message, say }) => {
        await reply(say, "```Commands: \n play <path to sound> \n knock knock```");
    })

    app.message(listRegex, async ({ message, say }) => {
        const match = message.text.match(listRegex);
        const folder = match[3];
        if (!folder) {
            // Reply with directories
            await reply(say, "```" + JSON.stringify(
                    getDirectories('./sounds')
                ).replace(/\,/g, '\n').replace(/\[|\]|\"/g, '') + "```");
        } else {
            // Reply with the files
            await reply(say, "```" + JSON.stringify(
                    getFiles('./sounds/' + folder).map((file) => folder + '/' + file.replace('.mp3', ''))
                ).replace(/\,/g, '\n').replace(/\[|\]|\"/g, '') + "```");
        }
        
    })

    app.message(playRegex, async ({ message, say }) => {
        const match = message.text.match(playRegex);
        const file = match[2];
        if (!file || ['help', 'list'].includes(file)) {
            return;
        }
        await reply(say, `Attempting to play sounds/${match[2]}.mp3`);
        sound.play(`sounds/${match[2]}.mp3`);
    })
    
    console.log('Slack Racket is running! (⚡️ Bolt)');
})();