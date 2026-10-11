const allowedTypes = ["image/jpeg", "image/png", "application/pdf"]
const maxSize = 10
let cameraStream = null;


//check file size and throw error if not right
function validate(file){
    if(!allowedTypes.includes(file.type)){
        throw new Error("Please upload a JPG, PNG, or PDF.")
    }
    if(file.size > maxSize *1024*1024) {
        throw new Error("File too large. Max 10MB")
    }
}

// Open the file picker (or the phone camera) and return the chosen file.
// Returns null if the user cancels.
export function pickFile(usePhoneCamera = false){
    return new Promise((resolve,reject)=>{
        const input = document.createElement("input");
        input.type = "file";
        input.accept = allowedTypes.join(",");
        if (usePhoneCamera) {
            input.capture = "environment";
        }

        input.onchange = () => {
            const file = input.files[0];
            if (!file) return resolve(null);
            try {
                validate(file);
                resolve(file);
            } catch (err) {
                reject(err);
            }
        };
        input.oncancel = () => resolve(null);

        input.click();
    })
}

// Open the file picker allowing several files at once. Returns
// { files: [valid files], rejected: [{ name, reason }] } so one bad file
// (wrong type or too big) doesn't block the rest, or null if cancelled.
export function pickFiles(){
    return new Promise((resolve)=>{
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = allowedTypes.join(",");

        input.onchange = () => {
            const chosen = [...input.files];
            if (chosen.length === 0) return resolve(null);
            const files = [];
            const rejected = [];
            for (const file of chosen) {
                try {
                    validate(file);
                    files.push(file);
                } catch (err) {
                    rejected.push({ name: file.name, reason: err.message });
                }
            }
            resolve({ files, rejected });
        };
        input.oncancel = () => resolve(null);

        input.click();
    })
}
