// pb_hooks/style.js
//
// Формулировки, которых врач не пишет, — общие правила для подсказок
// (suggest.pb.js), автозаключения (conclude.pb.js) и проверки протокола
// (review.pb.js: там они исправляются правками). Не *.pb.js — подключается
// внутри обработчика:
//   const style = require(`${__hooks}/style.js`)
module.exports = {
    FORBIDDEN: [
        "Never write \"нельзя исключить\", \"не исключается\", \"не исключено\" (or \"cannot be excluded\"); write \"подозрение на …\" or \"изменения, подозрительные на …\" instead.",
        "Never write modality prefixes such as \"МР-признаки\", \"КТ-признаки\", \"МСКТ-признаки\", \"МР-картина\", \"КТ-картина\" (or \"MRI signs of\", \"CT signs of\"): it is obvious the findings come from this study - name the finding itself (\"разрыв мениска\", not \"МР-признаки разрыва мениска\").",
    ],
};
