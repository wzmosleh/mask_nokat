// node tests/parser.test.js — noms fictifs (ceux du fichier de test)
const P = require('../parser.js');

const NAMES = ['العلوي سلمى', 'بناني أمين', 'الإدريسي يوسف', 'التازي فاطمة الزهراء', 'برادة حمزة', 'الشرايبي مريم',
  'الفاسي عثمان', 'الوزاني إيمان', 'لحلو أيوب', 'العمراني خديجة', 'الكتاني يوسف', 'ولد محمد سالم', 'منت أحمد السالكة',
  'الرگيبي محمد لمين', 'بوزيد سلمى', 'الصحراوي ماء العينين', 'الخليفي زكرياء', 'العسري نهى', 'بلقاسم إلياس', 'المرابط آية',
  'حب نجاة', 'داها سلوى', 'الإدريسي يسرى', 'السباعي هاجر'];
const S = P.prepareStudents(NAMES.map((name, id) => ({ id, name })));

let fail = 0;
function check(text, expected) {
  const got = P.parse(text, S).map((e) => {
    if (e.type === 'skip') return 'skip';
    const who = e.candidates.length === 1 ? e.candidates[0].name : e.candidates.length > 1 ? 'AMBIGU' : e.noName ? 'COURANT' : 'INCONNU';
    return e.type === 'absent' ? `${who}:absent` : `${who}:${e.value}${e.status === 'bad' ? ':HORS' : ''}`;
  });
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(ok ? '✓' : '✗', text, '→', got.join(' | '), ok ? '' : `   (attendu: ${expected.join(' | ')})`);
}

// mode éparpillé : nom + note
check('سلمى العلوي طناش ونص', ['العلوي سلمى:12.5']);
check('أمين بناني عندو 14,5', ['بناني أمين:14.5']);
check('مريم سبعطاش الا ربع', ['الشرايبي مريم:16.75']);
check('عثمان خمسة عشر', ['الفاسي عثمان:15']);
check('خديجة العمراني 18 على 20', ['العمراني خديجة:18']);
check('Salma Alaoui quinze virgule vingt-cinq', ['العلوي سلمى:15.25']);
check('Amine Bennani seize et demi', ['بناني أمين:16.5']);
check('Hamza Berrada twelve and a half', ['برادة حمزة:12.5']);
check('إيمان ٢٠', ['الوزاني إيمان:20']);
check('أيوب ربعطاش وربع', ['لحلو أيوب:14.25']);
check('نهى 0', ['العسري نهى:0']);
check('حمزة تسعود، مريم عشرين، أيوب ثمنطاعش', ['برادة حمزة:9', 'الشرايبي مريم:20', 'لحلو أيوب:18']);
// hassaniya
check('محمد لمين اربعطاعش ونص', ['الرگيبي محمد لمين:14.5']);
check('السالكة اطناعش', ['منت أحمد السالكة:12']);
check('ماء العينين احداعش', ['الصحراوي ماء العينين:11']);
// français dit en darija, transcrit en arabe
check('إلياس كانز', ['بلقاسم إلياس:15']);
check('آية دوز اي دمي', ['المرابط آية:12.5']);
// homonymes : il faut le nom complet
check('سلمى 12', ['AMBIGU:12']);
check('يوسف 10', ['AMBIGU:10']);
check('سلمى بوزيد 12', ['بوزيد سلمى:12']);
check('يوسف الكتاني 10', ['الكتاني يوسف:10']);
// orthographes de la reconnaissance vocale : voyelle finale, ا long, ة / ه, ى / ا
check('نجاة حبة 12', ['حب نجاة:12']);
check('حبه 12', ['حب نجاة:12']);
check('داها 14', ['داها سلوى:14']);
check('دها سلوى 14', ['داها سلوى:14']);
check('دهاء 14', ['داها سلوى:14']);
check('يسرا 11', ['الإدريسي يسرى:11']);
check('هجر السباعي 9', ['السباعي هاجر:9']);
check('سلوا 13', ['داها سلوى:13']);
// nom de famille seul, éventuellement coupé en deux par la reconnaissance
check('بوزيد 12', ['بوزيد سلمى:12']);
check('بو زيد 12', ['بوزيد سلمى:12']);
check('الشرايبي 15', ['الشرايبي مريم:15']);
check('لحلو 9', ['لحلو أيوب:9']);
check('الرگيبي 10', ['الرگيبي محمد لمين:10']);
check('الركيبي 10', ['الرگيبي محمد لمين:10']);
// hors intervalle
check('زكرياء 25', ['الخليفي زكرياء:25:HORS']);
// absents
check('مريم غايبة', ['الشرايبي مريم:absent']);
check('غائب أيوب لحلو', ['لحلو أيوب:absent']);
// mode ordonné : note seule, absent seul, passer
check('طناش ونص', ['COURANT:12.5']);
check('quatorze', ['COURANT:14']);
check('غايب', ['COURANT:absent']);
check('لم أجد ورقته مر للتالي', ['skip']);
check('ماكايناش الورقة فوت', ['skip']);
check('suivant', ['skip']);

// noms composés : le nom de famille seul suffit, quelle que soit la façon dont il est écrit
{
  const C = P.prepareStudents(['بنعبد الكريم  المهدي اسماعيل', 'ايت باها احمد زياد', 'المنصوري زايد', 'بن الطالب نهى', 'العلوي سلمى'].map((name, id) => ({ id, name })));
  const cases = [['بن عبد الكريم 12', 'بنعبد الكريم  المهدي اسماعيل'], ['بن عبدالكريم 12', 'بنعبد الكريم  المهدي اسماعيل'],
    ['ابن عبد الكريم 12', 'بنعبد الكريم  المهدي اسماعيل'], ['بن عبد الكريم المهدي 12', 'بنعبد الكريم  المهدي اسماعيل'],
    ['اسماعيل 12', 'بنعبد الكريم  المهدي اسماعيل'], ['ايت باها 11', 'ايت باها احمد زياد'], ['زياد 11', 'ايت باها احمد زياد'],
    ['زايد 11', 'المنصوري زايد'], ['بن الطالب 9', 'بن الطالب نهى'], ['ابن الطالب 9', 'بن الطالب نهى']];
  for (const [text, who] of cases) {
    const e = P.parse(text, C)[0];
    const got = e && e.candidates.length === 1 && e.status === 'ok' ? e.candidates[0].name : (e ? e.status + ':' + e.candidates.map((c) => c.name).join('/') : 'rien');
    const good = got === who; if (!good) fail++;
    console.log(good ? '✓' : '✗', text, '→', got);
  }
}

// fichier Massar en lettres latines, noms dictés en arabe
{
  const L = P.prepareStudents(['BENOMAR HIBA', 'EL ALAOUI SALMA', 'BOUZID SALMA', 'DAHA SALWA', 'KABBA NAJAT', 'LAHLOU AYOUB',
    'EL KETTANI YOUSSEF', 'EL IDRISSI YOUSSEF', 'CHRAIBI MERYEM', 'EL FASSI KARIM', 'HMIDOUCH ANAS'].map((name, id) => ({ id, name })));
  const cases = [['بن عمر هبة 12', 'BENOMAR HIBA'], ['هبة 12', 'BENOMAR HIBA'], ['العلوي 13', 'EL ALAOUI SALMA'],
    ['سلمى بوزيد 13', 'BOUZID SALMA'], ['داها 14', 'DAHA SALWA'], ['كبة نجاة 14', 'KABBA NAJAT'], ['لحلو 9', 'LAHLOU AYOUB'],
    ['يوسف الكتاني 10', 'EL KETTANI YOUSSEF'], ['الشرايبي مريم 16', 'CHRAIBI MERYEM'], ['لفاسي 8', 'EL FASSI KARIM'],
    ['حميدوش 9', 'HMIDOUCH ANAS'], ['Salma Alaoui 12', 'EL ALAOUI SALMA']];
  for (const [text, who] of cases) {
    const e = P.parse(text, L)[0];
    const got = e && e.candidates.length === 1 && e.status === 'ok' ? e.candidates[0].name : (e ? e.status + ':' + e.candidates.map((c) => c.name).join('/') : 'rien');
    const good = got === who; if (!good) fail++;
    console.log(good ? '✓' : '✗', text, '→', got);
  }
  const amb = P.parse('سلمى 12', L)[0];
  const good = amb.status === 'ambiguous'; if (!good) fail++;
  console.log(good ? '✓' : '✗', 'سلمى 12 → homonymes (lettres latines)');
}

// oui / non
for (const [t, e] of [['نعم', 'yes'], ['اه بدلها', 'yes'], ['واخا', 'yes'], ['oui', 'yes'], ['لا', 'no'], ['لا خليها', 'no'], ['non', 'no'], ['مريم 12', null]]) {
  const g = P.yesNo(t); if (g !== e) fail++;
  console.log(g === e ? '✓' : '✗', t, '→', g);
}

console.log(fail ? `\n${fail} échec(s)` : '\nTous les tests passent');
process.exit(fail ? 1 : 0);
