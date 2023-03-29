import {canonicalSerialize} from "../../src/util/canonical_json";

describe("canonicalSerialize", () => {
    it("should behave per spec", () => {
        expect(canonicalSerialize({})).toBe("{}");
        expect(
            canonicalSerialize({
                one: 1,
                two: "Two",
            }),
        ).toBe('{"one":1,"two":"Two"}');
        expect(
            canonicalSerialize({
                b: "2",
                a: "1",
            }),
        ).toBe('{"a":"1","b":"2"}');
        expect(canonicalSerialize({b: "2", a: "1"})).toBe('{"a":"1","b":"2"}');
        expect(
            canonicalSerialize({
                auth: {
                    success: true,
                    mxid: "@john.doe:example.com",
                    profile: {
                        display_name: "John Doe",
                        three_pids: [
                            {
                                medium: "email",
                                address: "john.doe@example.org",
                            },
                            {
                                medium: "msisdn",
                                address: "123456789",
                            },
                        ],
                    },
                },
            }),
        ).toBe(
            '{"auth":{"mxid":"@john.doe:example.com","profile":{"display_name":"John Doe","three_pids":[{"address":"john.doe@example.org","medium":"email"},{"address":"123456789","medium":"msisdn"}]},"success":true}}',
        );
        expect(
            canonicalSerialize({
                a: "日本語",
            }),
        ).toBe('{"a":"日本語"}');
        expect(
            canonicalSerialize({
                本: 2,
                日: 1,
            }),
        ).toBe('{"日":1,"本":2}');
        expect(
            canonicalSerialize({
                a: "\u65E5",
            }),
        ).toBe('{"a":"日"}');
        expect(
            canonicalSerialize({
                a: null,
            }),
        ).toBe('{"a":null}');
    });
});
