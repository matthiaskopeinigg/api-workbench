
export interface Environment {
  
  id: string;

  
  order: number;

  
  title: string;

  
  variables: {
    key: string;
    value: string;
    description?: string;
  }[];
}


