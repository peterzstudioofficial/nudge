import { boot } from "./boot";
import { ParentApp } from "../parent/ParentApp";

boot({ app: "parent", theme: "light", title: "nudge parent", render: (unpair) => <ParentApp onUnpair={unpair} /> });
