// Відображення «формат пристрою → модель двійника» (домен DCE → DTE)
function mapToDittoProtocolMsg(headers, textPayload, bytePayload, contentType) {
    var m = JSON.parse(textPayload);
    var name = headers["mqtt.topic"].split("/")[1]; // pzks/<name>/telemetry

    // Перетворення полів телеметрії у функціональні блоки Ditto
    var features = {
        runningGear: {
            properties: {
                speed: m.v
            }
        },

        motor: {
            properties: {
                rpm: m.rpm,
                temperature: m.temp
            }
        },

        battery: {
            properties: {
                current: m.i,
                voltage: m.u,
                stateOfCharge: m.soc
            }
        },

        brakes: {
            properties: {
                active: m.brk
            }
        },

        security: {
            properties: {
                locked: m.lck
            }
        },

        sync: {
            properties: {
                seq: m.seq,
                ts: m.ts
            }
        }
    };

    return Ditto.buildDittoProtocolMsg(
        "org.pzks",
        name,
        "things",
        "twin",
        "commands",
        "merge",
        "/features",
        {
            "content-type": "application/merge-patch+json"
        },
        features
    );
}
