require('dotenv').config();
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

// Missing Stuff:
// Whitelist
// Fuzzy Search + Response with similar sounds
// Speak command connected to amazon polly?
// Max sound length config

// Prevent sounds from playing while other sounds are playing
// https://www.npmjs.com/package/get-mp3-duration

// Allow other commands to run other than playing sounds while paused

// Add random messages

const getDirectories = srcPath => {
    try {
        return fs.readdirSync(srcPath).filter(file => fs.statSync(path.join(srcPath, file)).isDirectory());
    } catch {
        return [ `Path does not exist: ${srcPath}` ];
    }
};
const getFiles = srcPath => {
    try {
        return fs.readdirSync(srcPath).filter(file => !fs.statSync(path.join(srcPath, file)).isDirectory());
    } catch {
        return [ `Path does not exist: ${srcPath}` ];
    }
};

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
};

const formatFileListForSlack = (files) => {
    return "```" +JSON.stringify(files).replace(/\,/g, '\n').replace(/\[|\]|\"/g, '') + "```";
};

const knockKnock = async ({say}) => {
    await say(`_Who's there?_`);
    sound.play("sounds/kungfury/knockles.mp3");
};

const playHelp = async ({ message, say }) => {
    await say("```Commands: \n play <sound> \n play list <folder> \n play listdir \n play search <search>```");
};

const messageMap = [
    { match: 'knock knock', cb: knockKnock },
    { match: 'play help', cb: playHelp },
];


/**
 * This filters through the messageMap recursively, continuing through the list every time a match is found and returns a positive
 * value, otherwise it stops after it finds its first match. 
 * @param {*} param0 
 * @param {*} index 
 * @returns void
 */
const messageReactor = async function ({ message, say }, index = 0) {
    const messageMapSlice = messageMap.slice(index);
    const matchIdx = messageMapSlice.findIndex(messageMatch => {
        const msg = message.text || '', type = typeof messageMatch.match;
        if (messageMatch.match && type == 'string') {
            return msg.includes(messageMatch.match);
        }
        if (type == 'function') {
            return messageMatch.match(msg);
        }
        if (messageMatch.match instanceof RegExp) {
            return messageMatch.match.test(msg);
        }
    });
    if (matchIdx < 0) return;
    const match = messageMapSlice[matchIdx];
    const safeSay = async (msg) => {
        const postAsSlackBot = process.env.REPLY_ENABLED;
        if (/true/i.test(postAsSlackBot)) {
            await say(msg);
            console.log(msg);
        } else {
            console.log(msg);
        }
    };
    const proceed = await match.cb({message, say: safeSay});
    if (proceed) {
        messageReactor({message, say}, matchIdx + index + 1);
    }
};

(async () => {
    const playRegex = /^(play)\s+([a-zA-Z0-9_\-\/]+)/;
    const searchRegex = /^(play search)\s+([a-zA-Z0-9_\-\/]+)/;
    const listRegex = /^(play list|play listdir)(\s+|)(.+)/;

    await app.start(process.env.PORT || 3009);

    app.message(messageReactor);

    app.message(listRegex, async ({ message, say }) => {
        const match = message.text.match(listRegex);
        const searchFolder = match[3] || match[1] !== 'play listdir';
        if (!searchFolder) {
            // Reply with all directories
            await reply(say, formatFileListForSlack(getDirectories('./sounds')));
        } else {
            // Reply with files in a given folder
            await reply(say, formatFileListForSlack(getFiles('./sounds/' + folder).map((file) => folder + '/' + file.replace('.mp3', ''))));
        }
        
    });

    app.message(searchRegex, async ({ message, say }) => {
        const match = message.text.match(searchRegex);
        const search = match[2];
        if (!search) {
            await reply(say, `Yeah, I can't search for nothing... did you mean \`play list\`?`);
            return;
        }
        const files = findInDir('./sounds/', new RegExp(search));
        const numFiles = files.length;

        if (numFiles === 0) {
            await reply(say, `Hmm... I couldn't find anything with this term: \`${search}\``);
            return;
        }
        if (numFiles >= 1) {
            await reply(say, `${numFiles} result(s) for \`${search}\`! \n` + formatFileListForSlack(files));
        }
    });

    app.message(playRegex, async ({ message, say }) => {
        const match = message.text.match(playRegex);
        const search = match[2];
        if (!search || ['help', 'list', 'search'].includes(search)) {
            return;
        }

        const files = findInDir('./sounds/', new RegExp(search + '\.mp3$'));
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
            await reply(say, `Okay, here's the thing... I found ${numFiles} results ending with \`${search}\`, can you be more specific? \n` + formatFileListForSlack(files));
        }
    });
    
    console.log('Slack Racket is running! (⚡️ Bolt)');
})();