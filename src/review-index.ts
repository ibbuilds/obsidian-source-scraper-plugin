import type {EntityRecord} from "./contracts.ts";

/** One bounded index per mounted result set. No cross-project/global cache. */
export class ReviewIndex {
  private rows?:Array<{entity:EntityRecord;fields:string[]}>;
  private lastQuery?:string;
  private lastResult:EntityRecord[]=[];
  private readonly records:EntityRecord[];
  constructor(records:EntityRecord[]){this.records=records;}
  filter(search:string):EntityRecord[]{
    const query=search.toLowerCase();
    if(!query)return this.records;
    if(query===this.lastQuery)return this.lastResult;
    this.rows??=this.records.map(entity=>({entity,fields:[entity.title,entity.key,entity.type,entity.category].map(value=>value.toLowerCase())}));
    this.lastQuery=query;
    return this.lastResult=this.rows.filter(row=>row.fields.some(value=>value.includes(query))).map(row=>row.entity);
  }
}
