const personaFieldNames = ["name", "pronouns", "appearance", "background", "details", "exampleDialogues"];

export function populatePersonaForm(fields, persona = {}) {
    personaFieldNames.forEach((name) => {
        const field = fields[name];
        if (!field) return;
        const sourceName = name === "exampleDialogues" ? "example_dialogues" : name;
        field.value = persona[sourceName] || "";
    });
}

export function readPersonaForm(fields) {
    return personaFieldNames.reduce((payload, name) => {
        const field = fields[name];
        if (!field) return payload;
        payload[name] = field.value.trim();
        return payload;
    }, {});
}
