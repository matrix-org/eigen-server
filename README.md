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

*Note*: As of writing, there is no server-server API this thing can talk to, unfortunately.

1. `yarn dev:server` to start the server. This will block until killed.
2. In a new terminal window, `yarn dev:client:nobuild`. This will also block until killed.
3. In a third terminal, `yarn dev:client:nobuild`.
4. Grab the auto-assigned user ID from the third terminal and put it on your clipboard.
5. In the second terminal window (first client), type `/createRoom` and press <kbd>Enter</kbd>.
6. You should now have a room that you're chatting in.
7. Type `/invite <the other user ID>` and press <kbd>Enter</kbd>.
8. In the third terminal (second client), follow the instructions to accept the invite.
9. Send whatever text you like in either client and it should be received on the other end.

Some additional notes:
* The terminal client doesn't support backspace. Just "send" the typo and it'll be fine.
* All rooms and users are held in memory for now.
