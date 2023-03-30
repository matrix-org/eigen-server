import {FederationConnectionCache, FederationUrl} from "./FederationConnectionCache";

export class FederationClient {
    private url?: FederationUrl;

    public constructor(private forDomain: string) {}

    private async getUrl(): Promise<FederationUrl> {
        if (this.url) {
            return this.url;
        }
        this.url = await FederationConnectionCache.getFederationUrl(this.forDomain);
        return this.url;
    }

    public async getSigningKeys(): Promise<{
        old_verify_keys: Record<string, string>;
        server_name: string;
        signatures: Record<string, Record<string, string>>;
        valid_until_ts: number;
        verify_keys: Record<string, {key: string}>;
    }> {
        // TODO: Support https properly - https://github.com/matrix-org/linearized-matrix/issues/14
        // TODO: Handle http errors - https://github.com/matrix-org/linearized-matrix/issues/15
        return await (await fetch(`${(await this.getUrl()).httpsUrl}/_matrix/key/v2/server`)).json();
    }
}
