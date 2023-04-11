# eigen-server

Example server for a Linearized Matrix hub & participant. Note that the included client is awful and only for
demonstrative purposes: a proper implementation of Linearized Matrix would be bringing an existing, more useful,
client.

Specifications:
* [MSC3995: Linearized Matrix](https://github.com/matrix-org/matrix-spec-proposals/pull/3995) - Covers *everything* in
  the Linearized Matrix stack, including DAG interoperability.
* [I-D.ralston-mimi-linearized-matrix](https://datatracker.ietf.org/doc/draft-ralston-mimi-linearized-matrix/) - Covers
  just the bits which pertain to non-DAG consumers. Note that the I-D lags behind the MSC in terms of accuracy and latest
  thinking at the moment.

**Do not use this in production.** It's just not meant to scale, and likely never will.

## Development

Requires NodeJS 18.x and yarn.

1. Clone repo
2. `yarn install`

To start the awful demo client: `yarn dev:client`

To start the demo server: `yarn dev:server`

Client environment variables:
* `ES_CREATE_ROOM`: When `true`, the client will create a new room on startup.
* `ES_SEND_INVITE`: When set to a string, the client will auto-invite that user ID to the first room it joins/creates.
* `ES_LOCALPART`: The desired localpart for the client. If already picked then the server will return a random localpart.

### Setting up a demo

1. `ES_PORT=3000 ES_SIGNING_KEY_PATH=./p3000.signing.key yarn dev:server` to start the server. This will block until killed.
2. `ES_PORT=3001 ES_SIGNING_KEY_PATH=./p3001.signing.key yarn dev:server` to start the second server in a new terminal window.
3. In a new terminal window, `ES_PORT=3000 yarn dev:client:nobuild`. This will also block until killed.
4. In a fourth terminal window, `ES_PORT=3001 yarn dev:client:nobuild` to start the second client.
5. Grab the auto-assigned user ID from the fourth terminal and put it on your clipboard.
6. In the third terminal window (first client), type `/createRoom` and press <kbd>Enter</kbd>.
7. You should now have a room that you're chatting in.
8. Type `/invite <the other user ID>` and press <kbd>Enter</kbd>.
9. In the fourth terminal (second client), follow the instructions to accept the invite.
10. Send whatever text you like in either client and it should be received on the other end. This will be going over local federation.

Some additional notes:
* The terminal client doesn't support backspace. Just "send" the typo and it'll be fine.
* All rooms and users are held in memory for now.

### Synapse demo

You will need a Synapse running the [`clokep/lm` branch](https://github.com/matrix-org/synapse/compare/develop...clokep/lm).

1. Create the room on the eigen-server hub.
2. Invite your Synapse user.
3. Success! (probably)
