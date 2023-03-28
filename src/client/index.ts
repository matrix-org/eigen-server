import inquirer from "inquirer";

const ui = new inquirer.ui.BottomBar();

ui.log.write("--------------------------------------------------");
ui.log.write("==     LINEARIZED MATRIX DEVELOPMENT CLIENT     ==");
ui.log.write("--------------------------------------------------");
ui.log.write("Not for production use. Limited to a single room.");
ui.log.write("Press Ctrl+C to exit or type '\\q'");
ui.log.write("--------------------------------------------------");
ui.log.write("");

let buffer: string = "";

function render() {
    ui.updateBottomBar("> " + buffer);
}
render();

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (key: string) => {
    if (key === "\u0003") {
        process.exit(0); // Ctrl+C
    } else if (key === "\u000d") {
        if (buffer.trim() === "\\q") {
            process.exit(0);
        }
        ui.log.write(buffer); // TODO: Actually send message
        buffer = "";
        render();
        return;
    }
    buffer += key;
    render();
});
