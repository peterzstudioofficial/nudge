import { boot } from "./boot";
import { NotesApp } from "../notes/NotesApp";

boot({ app: "owner", theme: "paper", title: "notes", standalone: true, render: () => <NotesApp /> });
