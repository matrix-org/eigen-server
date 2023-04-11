export class FunctionQueue {
    private fns: Function[] = [];

    public add(fn: Function) {
        this.fns.push(fn);
    }

    public run() {
        for (const fn of this.fns) {
            fn();
        }
        this.fns = [];
    }
}
