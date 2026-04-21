import { Request } from "./request";
import { Response } from "./response";


export interface RequestHistory {
  
  entries: RequestHistoryEntry[];
}


export interface RequestHistoryEntry {
  
  id: string;

  
  createdAt: Date;

  
  request: Request;

  
  response: Response;
}


