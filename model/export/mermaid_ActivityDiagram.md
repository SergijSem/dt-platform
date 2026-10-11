stateDiagram-v2
    [*] --> TelemetryReceived : Отримання відліку (8 сигналів)
    
    state "Валідація та перевірка сигналів" as TelemetryReceived
    TelemetryReceived --> ValidateData
    
    state ValidateData <<choice>>
    ValidateData --> StateUpdate : Дані коректні
    ValidateData --> ErrorHandling : Помилка / Аномалія
    
    state "Оновлення стану двійника" as StateUpdate
    StateUpdate --> SaveToDB 
    
    state "Збереження в DB" as SaveToDB
    SaveToDB --> UINotify 
    
    state "Сповіщення інтерфейсу (UI)" as UINotify
    UINotify --> [*] 
    
    state "Обробка помилки / Сповіщення" as ErrorHandling
    ErrorHandling --> [*]