# slack-racket
![image](https://user-images.githubusercontent.com/14797002/124336212-669c7000-db5a-11eb-971d-601bf21aa8c2.png)

## Setup
`npm ci`

## Server
1. Set WS_PORT to the port you want to host the server at
... (will update with instructions here soon)
## Clients
1. Change WS_URL and WS_PORT to the url and port the server is running
2. Make a directory for tmp `mkdir ./tmp`
3. Set IS_SERVER to false
4. To get Speak to work: change ENABLE_SPEAK to true Set up an amazon polly account / fill in the related aws keys https://docs.aws.amazon.com/polly/latest/dg/getting-started.html
5. Have fun!

## Running the server

Run `node app.js`

---

Icon in screenshot by LORC (https://lorcblog.blogspot.com/)
