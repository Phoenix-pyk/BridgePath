import logo_placeholder from "../assets/logo_placeholder.png";

export default function HomeScreen({ goNext }) {
    return (
        <div>
            <img src={logo_placeholder} alt="BridgePath Logo" width={120} />
            <h1>BridgePath</h1>
            <p>
                Applying for food benefits (SNAP) in New York means a long form and a lot of paperwork.
                BridgePath makes it easier: take photos of documents you already have, like pay stubs,
                your ID, or your lease, and we read them for you. We ask only the questions your
                documents don't answer, tell you whether you're likely to qualify, and fill out your
                application form so it's ready to sign and send.
            </p>
            <p>It's free, and it takes about 15 minutes.</p>

            <button onClick={goNext}>I'm ready to apply</button>
        </div>
    );
}
