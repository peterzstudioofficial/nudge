import { boot } from "./boot";
import { Admin } from "../admin/Admin";

boot({ app: "owner", theme: "dark", title: "nudge setup", render: () => <Admin app="owner" /> });
