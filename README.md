# linearized-matrix
Example server and development test client for Linearized Matrix

I-D: https://datatracker.ietf.org/doc/draft-ralston-mimi-linearized-matrix/

MSC: TBD

**TODO**: Better description.

**Not intended for production usage, currently.**

## Development

Requires NodeJS 18.x and yarn

1. Clone repo
2. `yarn install`

To start the demo (awful) client: `yarn dev:client`

To start the demo server: `yarn dev:server`

### Setting up a demo

1. `LM_PORT=3000 LM_SIGNING_KEY_PATH=./p3000.signing.key yarn dev:server` to start the server. This will block until killed.
2. `LM_PORT=3001 LM_SIGNING_KEY_PATH=./p3001.signing.key yarn dev:server` to start the second server in a new terminal window.
3. In a new terminal window, `LM_PORT=3000 yarn dev:client:nobuild`. This will also block until killed.
4. In a fourth terminal window, `LM_PORT=3001 yarn dev:client:nobuild` to start the second client.
5. Grab the auto-assigned user ID from the fourth terminal and put it on your clipboard.
6. In the third terminal window (first client), type `/createRoom` and press <kbd>Enter</kbd>.
7. You should now have a room that you're chatting in.
8. Type `/invite <the other user ID>` and press <kbd>Enter</kbd>.
9. In the fourth terminal (second client), follow the instructions to accept the invite.
10. Send whatever text you like in either client and it should be received on the other end. This will be going over local federation.

Some additional notes:
* The terminal client doesn't support backspace. Just "send" the typo and it'll be fine.
* All rooms and users are held in memory for now.
