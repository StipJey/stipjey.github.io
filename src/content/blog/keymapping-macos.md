---
title: 'Настриваем внешнюю клавиатуру на MacOS'
description: 'При подключении внешней клавиатуры могут быть перепутаны клавиши Command и Option, стандартными средствами это не исправить. Но решение есть!'
pubDate: 'Jun 12 2024'
---

В MacOS есть встроенная утилита, которая позволяет переназначать клавиши. Называется она `hidutil`.

Для того чтобы поменять кнопки местами, достаточно ввести простую команду в терминале. Команду я не скажу, потому что на самом деле не имеет смысла ее вводить, так как после перезагрузки компьютера всё сбросится обратно. Гораздо эффективнее сделать автоматизацию, которая будет запускаться при старте системы с помощью встроенных средств MacOS.

### Находим устройство

Начнем с начала. Для того, чтобы назначить смену кнопок для **конкретной** клавиатуры, то нужно найти ее ID.
Вводим в терминал команду:

```bash
hidutil list
```

В списке ищем нужную клавиатуру. У меня она называлась просто: USB Device.

Если терминал — это не твоё, или клавиатура не нашлась, то есть и более простой способ:
Тыкаем на яблочко (в верхнем левом углу) → Об этом мак → Подробнее → Отчет о системе → USB → Ищем наше устройство

В результате нужно получить ID устройства в формате `0x0102`

### Настройка скрипта

На сайте https://hidutil-generator.netlify.app/ можно выбрать какие кнопки на какие менять и он автоматом сгенерирует нужный код скрипта.
Нужно его доработать. Добавляем в скрипт после строки с `property` следующий код

```plist
<string>--matching</string>
<string>{"ProductID":0x0102}</string>
```
 
 где 0х0102 — это ID клавиатуры из предыдущего шага.

 В результате получаем такой вот текст:

```plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.local.KeyRemapping</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/hidutil</string>
        <string>property</string>
        <string>--matching</string>
        <string>{"ProductID":0x0102}</string>
        <string>--set</string>
        <string>{"UserKeyMapping":[
            {
              "HIDKeyboardModifierMappingSrc": 0x7000000E3,
              "HIDKeyboardModifierMappingDst": 0x7000000E2
            },
            {
              "HIDKeyboardModifierMappingSrc": 0x7000000E2,
              "HIDKeyboardModifierMappingDst": 0x7000000E3
            }
        ]}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

Его сохраняем в файл с названием `com.local.KeyRemapping.plist` в папочку `~/Library/LaunchAgents/`

Теперь перезагружаем компьютер и наслаждаемся печатью.
