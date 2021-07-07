const { App } = require('@slack/bolt');
const sound = require('sound-play');
const fs = require('fs');
const path = require('path');

// import FuzzySearch from 'fuzzy-search';

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

const findInDir = (dir, filter, fileList = []) => {
    const files = fs.readdirSync(dir);

    files.forEach((file) => {
        const filePath = path.join(dir, file);
        const fileStat = fs.lstatSync(filePath);

        if (fileStat.isDirectory()) {
            findInDir(filePath, filter, fileList);
        } else if (filter.test(filePath)) {
            fileList.push(filePath);
        }
    });

    return fileList;
}

const formatFileListForSlack = (files) => {
    return "```" +JSON.stringify(files).replace(/\,/g, '\n').replace(/\[|\]|\"/g, '') + "```"
}
    
(async () => {
    const playRegex = /^(play)\s+([a-zA-Z0-9_\-\/\.]+)/;
    const listRegex = /^(play list|play folders)(\s+|)(.+)/;

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
            await reply(say, formatFileListForSlack(getDirectories('./sounds')));
        } else {
            // Reply with the files
            await reply(say, formatFileListForSlack(getFiles('./sounds/' + folder).map((file) => folder + '/' + file.replace('.mp3', ''))));
        }
        
    })

    app.message(playRegex, async ({ message, say }) => {
        const match = message.text.match(playRegex);
        const search = match[2];
        if (!search || ['help', 'list'].includes(search)) {
            return;
        }

        const files = findInDir('./sounds/', new RegExp(search));
        const numFiles = files.length;

        if (numFiles === 0) {
            await reply(say, `Hmm... I couldn't find: \`${search}\``);
            return;
        }
        if (numFiles === 1) {
            await reply(say, `Playing ${files[0]}`);
            sound.play(`${files[0]}`);
        }
        if (numFiles > 1) {
            await reply(say, `Okay, here's the thing... I found ${numFiles} results for \`${search}\`, can you be more specific? \n` + formatFileListForSlack(files));
        }
    })
    
    console.log('Slack Racket is running! (⚡️ Bolt)');
})();