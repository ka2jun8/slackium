import * as _ from "underscore";

export function uniqueId(): string{
    function random4():string{
        return Math.random().toString(36).slice(-4);
    }
    return random4() + random4() + random4() + random4();
};

export function notSupported(message?: string){
    class NotSupported extends Error{
    }

    if(message){
        throw new NotSupported(message);
    }else{
        throw new NotSupported("Not Supported");
    }
}

export function doNothing(){
}

export function stringify(target: any): string{
    if(target instanceof Error){
        return String(target);
    }else if(target && _.isString(target.message)){
        return target.message;
    }else if(_.isNumber(target) || _.isBoolean(target) || _.isString(target) || _.isRegExp(target)){
        return "" + target;
    }else if(target){
        try{
            return JSON.stringify(target);
        }catch(error){
            if(_.isFunction(target.toString)){
                return target.toString();
            }else{
                return "null";
            }
        }
    }else{
        return "null";
    }
}
