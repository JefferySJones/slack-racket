// Missing Stuff - In priority order:
// User Whitelist/Alias List in google sheets
// Channel whitelist in google sheets
// Speak command connected to amazon polly?
// Max sound length config
// Random-ish responses
// Listen to private channels (Currently only seems to work in public channels?)
// Channel listen / active list
// Fuzzy Search? "Did you mean....?"

// Replace this with a google sheet
const userList = {
    'U0KARF25A': 'jefferyjones',
    'ULZMECW5R': 'bradenvw'
};

const onlyAllowRecognizedUsers = true;

// Replace this with a google sheet
const rateLimitMsList = {
    'U0KARF25A': 5000,
    'default': 10000
};

require('dotenv').config();
const { App } = require('@slack/bolt');

// Amazon Polly
const AWS = require("aws-sdk");
const uuid = require('uuid');

// Node
const fs = require('fs');
const path = require('path');
const http = require('https');

// MP3 Stuff
const sound = require('sound-play');
const getMP3Duration = require('get-mp3-duration');

// Other
// import FuzzySearch from 'fuzzy-search';

AWS.config.getCredentials(function(err) {
    if (err) { 
        // credentials not loaded
        console.log(err.stack);
    } else {
        console.log("AWS Credentials Loaded for Speak Commands");
    }
});
AWS.config.update({ region: 'us-east-1' });

// Initializes your app with your bot token and signing secret
const app = new App({
    socketMode: true,
    appToken: process.env.APP_TOKEN,
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const getDirectories = srcPath => {
    try {
        return fs.readdirSync(srcPath).filter(file => fs.statSync(path.join(srcPath, file)).isDirectory());
    } catch {
        return `Path does not exist: ${srcPath}`;
    }
};
const getFiles = srcPath => {
    try {
        return fs.readdirSync(srcPath).filter(file => !fs.statSync(path.join(srcPath, file)).isDirectory());
    } catch {
        return `Path does not exist: ${srcPath}`;
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

const formatFileListForSlack = (files,page=1,pageSize=50) => {
    page = +page;
    if (typeof page != 'number') {
        page = 1;
    }
    const index = (page - 1) * pageSize;
    const pagination = files.length > pageSize ?
        `\nPage ${page} of ${Math.ceil(files.length % pageSize ? Math.floor(files.length / pageSize) + 1 : files.length / pageSize)}`
        : '';
    files = files.slice(index, index + pageSize);
    if (files.length) {
        const fileList = "```" +JSON.stringify(files).replace(/\,/g, ', ').replace(/\[|\]|\"/g, '') + "```";
        return fileList+pagination;
    } else {
        return 'Page not found.';
    }
};

const knockKnock = async ({say}) => {
    await say(`_Who's there?_`);
    sound.play("sounds/kungfury/knockles.mp3");
};

const playHelp = async ({ message, say }) => {
    await say("```Commands: \n play <sound> \n play list <folder> \n play listdir \n play search <search>```");
};

const listRegex = /^(play listdir|play list)(?:\s+|)([^\d\s]+)?(?:\s+|)(\d+)?/;
const list = async ({message, say}) => {
    let reply = '';
    const [,dirMatch,searchFolder,page] = message.text.match(listRegex);
    if (!searchFolder || dirMatch == 'play listdir') {
        // Reply with all directories
        const directories = getDirectories('./sounds');
        if (directories instanceof Array) {
            reply = formatFileListForSlack(directories,page,50);
        } else {
            reply = directories;
        }
    } else {
        // Reply with files in a given folder
        let files = getFiles('./sounds/' + searchFolder);
        if (files instanceof Array) {
            files = files.map((file) => file.replace('.mp3', ''));
            reply = formatFileListForSlack(files, page);
        } else {
            reply = files;
        }
    }
    if (reply) {
        await say(reply);
    }
};

const searchRegex = /^(?:play search)\s+([a-zA-Z0-9_\-\/]+)(?:\s+|)(\d+)?/;
const search = async ({message, say}) => {
    const [,search,page] = message.text.match(searchRegex);
    if (!search) {
        await say(`Yeah, I can't search for nothing... did you mean \`play list\`?`);
        return;
    }
    const files = findInDir('./sounds/', new RegExp(search));
    const numFiles = files.length;

    if (numFiles === 0) {
        await say(`Hmm... I couldn't find anything with this term: \`${search}\``);
        return;
    }
    if (numFiles >= 1) {
        await say(`${numFiles} result(s) for \`${search}\`! \n` + formatFileListForSlack(files,page));
    }
};

const speakRegex = /^(?:speak)\s+([a-zA-Z0-9_\-\/ \?\!\.\,]+)/;
const speak = async ({ message, say }) => {
    if (fs.existsSync('./tmp/lock')) {
        const timeTilUnlock = ((Number(fs.readFileSync('./tmp/lock', 'utf8')) - Date.now()) / 1000).toFixed(1);
        if (timeTilUnlock > 0) {
            say(`Sorry, you need to wait for the other sounds to stop.. Try again in ${timeTilUnlock} seconds`)
            return;
        }
    }
    if (fs.existsSync('./tmp/' + message.user + '-lock')) {
        const timeTilUnlock = ((Number(fs.readFileSync('./tmp/' + message.user + '-lock', 'utf8')) - Date.now()) / 1000).toFixed(1);
        if (timeTilUnlock > 0) {
            say(`You need to wait to send another sound command.. Try again in ${timeTilUnlock} seconds`)
            return;
        }
    }

    const [,speech] = message.text.match(speakRegex);
    const speechParams = {
        OutputFormat: "mp3",
        SampleRate: "16000",
        Text: speech,
        TextType: "text",
        VoiceId: "Brian"
    };
    
    // Create the Polly service object and presigner object
    const polly = new AWS.Polly({apiVersion: '2016-06-10'});
    const signer = new AWS.Polly.Presigner(speechParams, polly)
    
    // Create presigned URL of synthesized speech file
    signer.getSynthesizeSpeechUrl(speechParams, function(error, url) {
        if (error) {
            console.log(error.stack);
        } else {
            const file = fs.createWriteStream("./tmp/speech.mp3");
            http.get(url, function(response) {
                response.pipe(file);
                const path = './tmp/speech.mp3';
                playFile({ message, say, path });
            });
        }
    });
};

const playFile = ({ message, say, path }) => {
    const buffer = fs.readFileSync(path);
    const duration = getMP3Duration(buffer);
    fs.writeFileSync('./tmp/lock', Date.now() + duration, 'utf8');
    
    sound.play(`${path}`);
    setTimeout(() => { 
        if (fs.existsSync('./tmp/lock')) { 
            fs.unlinkSync('./tmp/lock');
        }
    }, duration);

    const rateLimitMs = getUserRateLimit(message.user);
    fs.writeFileSync('./tmp/' + message.user + '-lock', Date.now() + rateLimitMs, 'utf8');
    setTimeout(() => { 
        if (fs.existsSync('./tmp/' + message.user + '-lock')) { 
            fs.unlinkSync('./tmp/' + message.user + '-lock');
        }
    }, rateLimitMs);
}

const playRegex = /^(?:play)\s+([a-zA-Z0-9_\-\/]+)/;
const play = async ({ message, say }) => {
    if (fs.existsSync('./tmp/lock')) {
        const timeTilUnlock = ((Number(fs.readFileSync('./tmp/lock', 'utf8')) - Date.now()) / 1000).toFixed(1);
        if (timeTilUnlock > 0) {
            say(`Sorry, you need to wait for the other sounds to stop.. Try again in ${timeTilUnlock} seconds`)
            return;
        }
    }
    if (fs.existsSync('./tmp/' + message.user + '-lock')) {
        const timeTilUnlock = ((Number(fs.readFileSync('./tmp/' + message.user + '-lock', 'utf8')) - Date.now()) / 1000).toFixed(1);
        if (timeTilUnlock > 0) {
            say(`You need to wait to send another sound command.. Try again in ${timeTilUnlock} seconds`)
            return;
        }
    }
    const [,search] = message.text.match(playRegex);

    const files = findInDir('./sounds/', new RegExp(search + '\.mp3$'));
    const numFiles = files.length;

    if (numFiles === 0) {
        await say(`Hmm... I couldn't find: \`${search}\``);
        return;
    }
    if (numFiles === 1) {
        const path = files[0];
        await say(`Playing ${path}`);
        playFile({ message, say, path });
    }
    if (numFiles > 1) {
        await say(`Okay, here's the thing... I found ${numFiles} results ending with \`${search}\`, can you be more specific? \n` + formatFileListForSlack(files));
    }

};

const findUser = (user) => {
    if (userList[user]) {
        return userList[user];
    }
    return null;
};

const getUserRateLimit = (user) => {
    if (rateLimitMsList[user] >= 0) {
        return rateLimitMsList[user];
    }
    return rateLimitMsList['default'];
}


// Reactive mapping
const messageMap = [
    { match: 'knock knock', cb: knockKnock },
    { match: 'play help', cb: playHelp },
    { match: listRegex, cb: list},
    { match: searchRegex, cb: search},
    { match: playRegex, cb: play},
    { match: speakRegex, cb: speak}
];

/**
 * This filters through the messageMap recursively, continuing through the list every time a match is found and returns a positive
 * value, otherwise it stops after it finds its first match. 
 * @param {*} param0 
 * @param {*} index 
 * @returns void
 */
const messageMiddleware = async ({ message, say }, index = 0) => {
    const foundUser = findUser(message.user);
    if (!foundUser) {
        console.log(message.user + ':', message.text);
    } else {
        console.log(foundUser + ':', message.text);
    }

    if (!foundUser && onlyAllowRecognizedUsers) {
        return;
    }

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
        messageMiddleware({message, say}, matchIdx + index + 1);
    }
};

(async () => {
    await app.start(process.env.PORT || 3009);

    if (fs.existsSync('./tmp/lock')) { 
        fs.unlinkSync('./tmp/lock');
    }

    fs.readdirSync('./tmp')
        .filter(file => file.endsWith('-lock'))
        .forEach(file => fs.unlinkSync('./tmp/' + file));

    app.message(messageMiddleware);
    
    console.log('Slack Racket is running! (⚡️ Bolt)');
})();