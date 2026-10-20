import logo from "../../assets/logo.png";
import "./HomeScreen.css";

export default function HomeScreen({ goNext }) {
    return (
        <div className="home">
            <img className="home-logo" src={logo} alt="BridgePath Logo" />
            <h1>BridgePath</h1>
            <p className="home-lead">
                Applying for food benefits (SNAP) in New York means a long form and a lot of paperwork.
                BridgePath makes it easier: take photos of documents you already have, like pay stubs,
                your ID, or your lease, and we read them for you. We ask only the questions your
                documents don't answer, tell you whether you're likely to qualify, and fill out your
                application form so it's ready to sign and send.
            </p>
            <p className="helper">It's free, and it takes about 15 minutes.</p>

            <div className="actions">
                <button className="btn-primary" onClick={goNext}>I'm ready to apply</button>
            </div>
        </div>
    );
}
