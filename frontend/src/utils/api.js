const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000"
const USE_MOCK = false; //Set to true to use canned mock data instead of the backend

async function request(path, options){
    let response;
    try {
        response = await fetch (BASE_URL+path, options);
    } catch (err){
        throw new Error("Can't reach server")
    }
    if(!response.ok){
        throw new Error("Server error: " + response.status);
    }
    return response;
}

export async function extract(file) {
    if(USE_MOCK){
        await new Promise((r) => setTimeout(r, 800)); // pretend it takes time
        return{
        documentType: "pay_stub",
        fields: { fullName: "Jane Doe", monthlyIncome: 1300, employer: "Queens College Library", payFrequency: "biweekly", workHours: 12 },
        issues: [],
        }
    }
    const body = new FormData(); //Browser's built-in
    body.append("file", file);
    const response = await request("/api/extract",{method: "POST", body});
    return response.json(); 
}


