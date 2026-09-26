import { boot } from "./boot";
import { MyApp } from "../my/MyApp";

boot({ app: "owner", theme: "dark", title: "nudge", render: (unpair) => <MyApp onUnpair={unpair} /> });
