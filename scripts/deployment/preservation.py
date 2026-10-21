"""Same-schema preservation policy. Importing this module performs no I/O."""
from config import require


MUTABLE_TABLES = ('exercise_sources', 'exercise_set_sources')

FINGERPRINT_JS = r'''
const Database=require('better-sqlite3'),crypto=require('crypto');
const db=new Database(process.argv[1],{readonly:true,fileMustExist:true});
try {
 const quote=name=>'"'+name.replaceAll('"','""')+'"';
 const digest=rows=>crypto.createHash('sha256').update(JSON.stringify(rows.map(row=>JSON.stringify(row)).sort())).digest('hex');
 const catalog=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
 const tables={};
 for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name NOT LIKE 'sqlite_%' OR name='sqlite_sequence') ORDER BY name").all()) {
  const columns=db.pragma('table_info('+quote(name)+')').map(row=>row.name);
  // Preserve hidden rowids too: catalog migration chooses the oldest insertion.
  const rows=db.prepare('SELECT rowid AS __magni_rowid,'+columns.map(quote).join(',')+' FROM '+quote(name)).all();
  tables[name]={columns,rows:rows.length,sha256:digest(rows)};
  if(['exercise_sources','exercise_set_sources'].includes(name)) {
   const protectedColumns=columns.filter(column=>column!=='exercise_id');
   const protectedRows=rows.map(row=>Object.fromEntries([['__magni_rowid',row.__magni_rowid],...protectedColumns.map(column=>[column,row[column]])]));
   tables[name].protectedColumns=protectedColumns;
   tables[name].protectedSha256=digest(protectedRows);
  }
 }
 const identityCoverage={
  sessionSets:db.prepare('SELECT count(*) n FROM session_sets').get().n,
  linkedSessionSets:db.prepare('SELECT count(*) n FROM session_sets ss JOIN sessions s ON s.id=ss.session_id JOIN exercise_set_sources x ON x.session_set_id=ss.id AND x.user_id=s.user_id').get().n,
  missingSetMappings:db.prepare('SELECT count(*) n FROM session_sets ss JOIN sessions s ON s.id=ss.session_id LEFT JOIN exercise_set_sources x ON x.session_set_id=ss.id AND x.user_id=s.user_id WHERE x.session_set_id IS NULL').get().n,
  missingSourceMappings:db.prepare('SELECT count(*) n FROM exercise_set_sources x LEFT JOIN exercise_sources s ON s.user_id=x.user_id AND s.source_key=x.source_key WHERE s.source_key IS NULL').get().n,
 };
 console.log(JSON.stringify({schemaRevision:db.pragma('user_version',{simple:true}),catalog,tables,identityCoverage,
 integrity:db.pragma('integrity_check',{simple:true}),foreignKeys:db.pragma('foreign_key_check').length,
 deletionMarkers:db.prepare('SELECT count(*) n FROM program_editor_drafts WHERE deleted_at IS NOT NULL').get().n}));
}finally{db.close();}
'''

def checked_fingerprint(value, schema):
    require(value['schemaRevision'] == schema and value['integrity'] == 'ok' and value['foreignKeys'] == 0,
            'Expected valid schema-' + str(schema) + ' database')
    coverage = value.get('identityCoverage', {})
    require(set(coverage) == {'sessionSets', 'linkedSessionSets', 'missingSetMappings', 'missingSourceMappings'}, 'Missing identity coverage fingerprint')
    require(coverage['sessionSets'] == coverage['linkedSessionSets'] and coverage['missingSetMappings'] == coverage['missingSourceMappings'] == 0,
            'Missing baseline identity mappings; refuse to widen preservation policy')
    require(value['tables']['session_sets']['rows'] == coverage['sessionSets'] == value['tables']['exercise_set_sources']['rows'], 'Set mapping cardinality differs')
    for name in MUTABLE_TABLES:
        table = value['tables'][name]
        require('exercise_id' in table['columns'] and table.get('protectedColumns') == [c for c in table['columns'] if c != 'exercise_id'] and bool(table.get('protectedSha256')),
                'Missing protected column fingerprint for ' + name)
    return value

def exact_preserved(observed, original, schema):
    checked_fingerprint(original, schema)
    checked_fingerprint(observed, schema)
    require(observed == original, 'Database schema or rows changed during exact-preservation check')
    return True
